'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const commonPathPrefix = require('common-path-prefix');
const uniqueTempDir = require('unique-temp-dir');
const isCi = require('is-ci');
const resolveCwd = require('resolve-cwd');
const debounce = require('lodash.debounce');
const Bluebird = require('bluebird');
const getPort = require('get-port');
const arrify = require('arrify');
const ms = require('ms');
const babelConfigHelper = require('./lib/babel-config');
const CachingPrecompiler = require('./lib/caching-precompiler');
const Emittery = require('./lib/emittery');
const RunStatus = require('./lib/run-status');
const AvaFiles = require('./lib/ava-files');
const fork = require('./lib/fork');
const serializeError = require('./lib/serialize-error');

function resolveModules(modules) {
	return arrify(modules).map(name => {
		const modulePath = resolveCwd.silent(name);

		if (modulePath === null) {
			throw new Error(`Could not resolve required module '${name}'`);
		}

		return modulePath;
	});
}

class Api extends Emittery {
	constructor(options) {
		super();

		this.options = Object.assign({match: []}, options);
		this.options.require = resolveModules(this.options.require);
	}

	run(files, runtimeOptions) {
		const apiOptions = this.options;
		runtimeOptions = runtimeOptions || {};

		// Each run will have its own status. It can only be created when test files
		// have been found.
		let runStatus;
		// Irrespectively, perform some setup now, before finding test files.

		// Track active forks and manage timeouts.
		const failFast = apiOptions.failFast === true;
		let bailed = false;
		const pendingWorkers = new Set();
		const timedOutWorkerFiles = new Set();
		let restartTimer;
		if (apiOptions.timeout) {
			const timeout = ms(apiOptions.timeout);

			restartTimer = debounce(() => {
				// If failFast is active, prevent new test files from running after
				// the current ones are exited.
				if (failFast) {
					bailed = true;
				}

				for (const worker of pendingWorkers) {
					timedOutWorkerFiles.add(worker.file);
					worker.exit();
				}

				runStatus.emitStateChange({type: 'timeout', period: timeout});
			}, timeout);
		} else {
			restartTimer = Object.assign(() => {}, {cancel() {}});
		}

		// Find all test files.
		return new AvaFiles({cwd: apiOptions.resolveTestsFrom, files}).findTestFiles()
			.then(files => {
				runStatus = new RunStatus(files.length);

				const emittedRun = this.emit('run', {
					clearLogOnNextRun: runtimeOptions.clearLogOnNextRun === true,
					failFastEnabled: failFast,
					filePathPrefix: commonPathPrefix(files),
					files,
					matching: apiOptions.match.length > 0,
					previousFailures: runtimeOptions.previousFailures || 0,
					runOnlyExclusive: runtimeOptions.runOnlyExclusive === true,
					runVector: runtimeOptions.runVector || 0,
					status: runStatus
				});

				// Bail out early if no files were found.
				if (files.length === 0) {
					return emittedRun.then(() => {
						return runStatus;
					});
				}

				runStatus.on('stateChange', record => {
					if (record.testFile && !timedOutWorkerFiles.has(record.testFile)) {
						// Restart the timer whenever there is activity from workers that
						// haven't already timed out.
						restartTimer();
					}

					if (failFast && (record.type === 'hook-failed' || record.type === 'test-failed' || record.type === 'worker-failed')) {
						// Prevent new test files from running once a test has failed.
						bailed = true;

						// Try to stop currently scheduled tests.
						for (const worker of pendingWorkers) {
							worker.notifyOfPeerFailure();
						}
					}
				});

				// Set up a fresh precompiler for each test run.
				return emittedRun
					.then(() => this._setupPrecompiler())
					.then(precompilation => {
						if (!precompilation) {
							return null;
						}

						// Compile all test and helper files. Assumes the tests only load
						// helpers from within the `resolveTestsFrom` directory. Without
						// arguments this is the `projectDir`, else it's `process.cwd()`
						// which may be nested too deeply.
						return new AvaFiles({cwd: this.options.resolveTestsFrom}).findTestHelpers().then(helpers => {
							return {
								cacheDir: precompilation.cacheDir,
								map: files.concat(helpers).reduce((acc, file) => {
									try {
										const realpath = fs.realpathSync(file);
										const hash = precompilation.precompiler.precompileFile(realpath);
										acc[realpath] = hash;
									} catch (err) {
										throw Object.assign(err, {file});
									}
									return acc;
								}, {})
							};
						});
					})
					.then(precompilation => {
						// Resolve the correct concurrency value.
						let concurrency = Math.min(os.cpus().length, isCi ? 2 : Infinity);
						if (apiOptions.concurrency > 0) {
							concurrency = apiOptions.concurrency;
						}
						if (apiOptions.serial) {
							concurrency = 1;
						}

						// Try and run each file, limited by `concurrency`.
						return Bluebird.map(files, file => {
							// No new files should be run once a test has timed out or failed,
							// and failFast is enabled.
							if (bailed) {
								return;
							}

							return this._computeForkExecArgv().then(execArgv => {
								const options = Object.assign({}, apiOptions, {
									// If we're looking for matches, run every single test process in exclusive-only mode
									runOnlyExclusive: apiOptions.match.length > 0 || runtimeOptions.runOnlyExclusive === true
								});
								if (precompilation) {
									options.cacheDir = precompilation.cacheDir;
									options.precompiled = precompilation.map;
								} else {
									options.precompiled = {};
								}
								if (runtimeOptions.updateSnapshots) {
									// Don't use in Object.assign() since it'll override options.updateSnapshots even when false.
									options.updateSnapshots = true;
								}

								const worker = fork(file, options, execArgv);
								runStatus.observeWorker(worker, file);

								pendingWorkers.add(worker);
								worker.promise.then(() => { // eslint-disable-line max-nested-callbacks
									pendingWorkers.delete(worker);
								});

								restartTimer();

								return worker.promise;
							});
						}, {concurrency});
					})
					.catch(err => {
						runStatus.emitStateChange({type: 'internal-error', err: serializeError('Internal error', false, err)});
					})
					.then(() => {
						restartTimer.cancel();
						return runStatus;
					});
			});
	}

	_setupPrecompiler() {
		const cacheDir = this.options.cacheEnabled === false ?
			uniqueTempDir() :
			path.join(this.options.projectDir, 'node_modules', '.cache', 'ava');

		return this._buildBabelConfig(cacheDir).then(result => {
			return result ? {
				cacheDir,
				precompiler: new CachingPrecompiler({
					path: cacheDir,
					getBabelOptions: result.getOptions,
					babelCacheKeys: result.cacheKeys
				})
			} : null;
		});
	}

	_buildBabelConfig(cacheDir) {
		if (this._babelConfigPromise) {
			return this._babelConfigPromise;
		}

		const compileEnhancements = this.options.compileEnhancements !== false;
		const promise = babelConfigHelper.build(this.options.projectDir, cacheDir, this.options.babelConfig, compileEnhancements);
		this._babelConfigPromise = promise;
		return promise;
	}

	_computeForkExecArgv() {
		const env = this.options.testOnlyEnv || process.env;
		let execArgv = this.options.testOnlyExecArgv || process.execArgv;

		// Append NODE_DEBUG_OPTION, if any, from env to our args (JetBrains IDE)
		const debugOpt = env.NODE_DEBUG_OPTION || '';
		if (debugOpt.length !== 0) {
			execArgv = execArgv.concat(debugOpt.split(/\s+/));
		}

		if (execArgv.length === 0) {
			return Promise.resolve(execArgv);
		}

		// --(inspect|debug)-brk is same as --(inspect|debug) but breaks on first line
		const debugRex = /^--(inspect|debug)(-brk)?(=.+)?$/;
		const debugFlag = Number(process.version.split('.')[0].slice(1)) < 8 ? 'debug' : 'inspect';
		let debugArg = false;
		let debugBrk = '';
		let debugPort = -1;

		// In case of several matches, use just the last one (same as Node CLI)
		execArgv = execArgv.filter(arg => {
			const debugMatch = debugRex.exec(arg);
			if (debugMatch === null) {
				return true;
			}
			debugBrk = debugMatch[2] || '';
			debugPort = Number(debugMatch[3]);
			debugArg = true;
			return false;
		});

		if (debugArg) {
			return Promise.resolve(execArgv);
		}

		if (debugPort !== -1) {
			if (!isNaN(debugPort) && debugPort >= 1024 && debugPort < 65536) {
				execArgv.push(`--${debugFlag}${debugBrk}=${debugPort}`);
				return Promise.resolve(execArgv);
			}
			console.warn(`'Invalid debug port ${debugPort}, falling back to automatic`);
		}

		return getPort().then(port => {
			execArgv.push(`--${debugFlag}${debugBrk}=${port}`);
			return execArgv;
		});
	}
}

module.exports = Api;
