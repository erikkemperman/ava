'use strict';
require('../lib/chalk').set();

const path = require('path');
const fs = require('fs');
const del = require('del');
const test = require('tap').test;
const Api = require('../api');

const testCapitalizerPlugin = require.resolve('./fixture/babel-plugin-test-capitalizer');

const ROOT_DIR = path.join(__dirname, '..');

function apiCreator(options) {
	options = options || {};
	options.babelConfig = options.babelConfig || {testOptions: {}};
	options.concurrency = 2;
	options.projectDir = options.projectDir || ROOT_DIR;
	options.resolveTestsFrom = options.resolveTestsFrom || options.projectDir;
	const instance = new Api(options);
	if (!options.precompileHelpers) {
		instance._precompileHelpers = () => Promise.resolve();
	}
	return instance;
}

test('ES2015 support', t => {
	const api = apiCreator();

	return api.run([path.join(__dirname, 'fixture/es2015.js')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('precompile helpers', t => {
	const api = apiCreator({
		precompileHelpers: true,
		resolveTestsFrom: path.join(__dirname, 'fixture/precompile-helpers')
	});

	return api.run()
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('generators support', t => {
	const api = apiCreator();

	return api.run([path.join(__dirname, 'fixture/generators.js')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('async/await support', t => {
	const api = apiCreator();

	return api.run([path.join(__dirname, 'fixture/async-await.js')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 2);
		});
});

test('fail-fast mode - single file & serial', t => {
	const api = apiCreator({
		failFast: true
	});

	const tests = [];

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'test-failed') {
				tests.push({
					ok: false,
					title: evt.title
				});
			} else if (evt.type === 'test-passed') {
				tests.push({
					ok: true,
					title: evt.title
				});
			}
		});
	});

	return api.run([path.join(__dirname, 'fixture/fail-fast/single-file/test.js')])
		.then(runStatus => {
			t.ok(api.options.failFast);
			t.strictDeepEqual(tests, [{
				ok: true,
				title: 'first pass'
			}, {
				ok: false,
				title: 'second fail'
			}, {
				ok: true,
				title: 'third pass'
			}]);
			t.is(runStatus.stats.passedTests, 2);
			t.is(runStatus.stats.failedTests, 1);
		});
});

test('fail-fast mode - multiple files & serial', t => {
	const api = apiCreator({
		failFast: true,
		serial: true
	});

	const tests = [];

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'test-failed') {
				tests.push({
					ok: false,
					testFile: evt.testFile,
					title: evt.title
				});
			} else if (evt.type === 'test-passed') {
				tests.push({
					ok: true,
					testFile: evt.testFile,
					title: evt.title
				});
			}
		});
	});

	return api.run([
		path.join(__dirname, 'fixture/fail-fast/multiple-files/fails.js'),
		path.join(__dirname, 'fixture/fail-fast/multiple-files/passes.js')
	])
		.then(runStatus => {
			t.ok(api.options.failFast);
			t.strictDeepEqual(tests, [{
				ok: true,
				testFile: path.join(__dirname, 'fixture/fail-fast/multiple-files/fails.js'),
				title: 'first pass'
			}, {
				ok: false,
				testFile: path.join(__dirname, 'fixture/fail-fast/multiple-files/fails.js'),
				title: 'second fail'
			}]);
			t.is(runStatus.stats.passedTests, 1);
			t.is(runStatus.stats.failedTests, 1);
		});
});

test('fail-fast mode - multiple files & interrupt', t => {
	const api = apiCreator({
		failFast: true,
		concurrency: 2
	});

	const tests = [];

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'test-failed') {
				tests.push({
					ok: false,
					testFile: evt.testFile,
					title: evt.title
				});
			} else if (evt.type === 'test-passed') {
				tests.push({
					ok: true,
					testFile: evt.testFile,
					title: evt.title
				});
			}
		});
	});

	return api.run([
		path.join(__dirname, 'fixture/fail-fast/multiple-files/fails.js'),
		path.join(__dirname, 'fixture/fail-fast/multiple-files/passes-slow.js')
	])
		.then(runStatus => {
			t.ok(api.options.failFast);
			t.strictDeepEqual(tests, [{
				ok: true,
				testFile: path.join(__dirname, 'fixture/fail-fast/multiple-files/fails.js'),
				title: 'first pass'
			}, {
				ok: false,
				testFile: path.join(__dirname, 'fixture/fail-fast/multiple-files/fails.js'),
				title: 'second fail'
			}, {
				ok: true,
				testFile: path.join(__dirname, 'fixture/fail-fast/multiple-files/fails.js'),
				title: 'third pass'
			}, {
				ok: true,
				testFile: path.join(__dirname, 'fixture/fail-fast/multiple-files/passes-slow.js'),
				title: 'first pass'
			}]);
			t.is(runStatus.stats.passedTests, 3);
			t.is(runStatus.stats.failedTests, 1);
		});
});

test('fail-fast mode - crash & serial', t => {
	const api = apiCreator({
		failFast: true,
		serial: true
	});

	const tests = [];
	const workerFailures = [];

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'test-failed') {
				tests.push({
					ok: false,
					title: evt.title
				});
			} else if (evt.type === 'test-passed') {
				tests.push({
					ok: true,
					title: evt.title
				});
			} else if (evt.type === 'worker-failed') {
				workerFailures.push(evt);
			}
		});
	});

	return api.run([
		path.join(__dirname, 'fixture/fail-fast/crash/crashes.js'),
		path.join(__dirname, 'fixture/fail-fast/crash/passes.js')
	])
		.then(runStatus => {
			t.ok(api.options.failFast);
			t.strictDeepEqual(tests, []);
			t.is(workerFailures.length, 1);
			t.is(workerFailures[0].testFile, path.join(__dirname, 'fixture', 'fail-fast', 'crash', 'crashes.js'));
			t.is(runStatus.stats.passedTests, 0);
			t.is(runStatus.stats.failedTests, 0);
		});
});

test('fail-fast mode - timeout & serial', t => {
	const api = apiCreator({
		failFast: true,
		serial: true,
		timeout: '100ms'
	});

	const tests = [];
	const timeouts = [];

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'test-failed') {
				tests.push({
					ok: false,
					title: evt.title
				});
			} else if (evt.type === 'test-passed') {
				tests.push({
					ok: true,
					title: evt.title
				});
			} else if (evt.type === 'timeout') {
				timeouts.push(evt);
			}
		});
	});

	return api.run([
		path.join(__dirname, 'fixture/fail-fast/timeout/fails.js'),
		path.join(__dirname, 'fixture/fail-fast/timeout/passes.js')
	])
		.then(runStatus => {
			t.ok(api.options.failFast);
			t.strictDeepEqual(tests, []);
			t.is(timeouts.length, 1);
			t.is(timeouts[0].period, 100);
			t.is(runStatus.stats.passedTests, 0);
			t.is(runStatus.stats.failedTests, 0);
		});
});

test('fail-fast mode - no errors', t => {
	const api = apiCreator({
		failFast: true
	});

	return api.run([
		path.join(__dirname, 'fixture/fail-fast/without-error/a.js'),
		path.join(__dirname, 'fixture/fail-fast/without-error/b.js')
	])
		.then(runStatus => {
			t.ok(api.options.failFast);
			t.is(runStatus.stats.passedTests, 2);
			t.is(runStatus.stats.failedTests, 0);
		});
});

test('serial execution mode', t => {
	const api = apiCreator({
		serial: true
	});

	return api.run([path.join(__dirname, 'fixture/serial.js')])
		.then(runStatus => {
			t.ok(api.options.serial);
			t.is(runStatus.stats.passedTests, 3);
			t.is(runStatus.stats.failedTests, 0);
		});
});

test('run from package.json folder by default', t => {
	const api = apiCreator();

	return api.run([path.join(__dirname, 'fixture/process-cwd-default.js')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('control worker\'s process.cwd() with projectDir option', t => {
	const fullPath = path.join(__dirname, 'fixture/process-cwd-pkgdir.js');
	const api = apiCreator({projectDir: path.dirname(fullPath)});

	return api.run([fullPath])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('stack traces for exceptions are corrected using a source map file', t => {
	t.plan(4);

	const api = apiCreator({
		cacheEnabled: true
	});

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'uncaught-exception') {
				t.match(evt.err.message, /Thrown by source-map-fixtures/);
				t.match(evt.err.stack, /^.*?Object\.t.*?as run\b.*source-map-fixtures.src.throws.js:1.*$/m);
				t.match(evt.err.stack, /^.*?Immediate\b.*source-map-file.js:4.*$/m);
			}
		});
	});

	return api.run([path.join(__dirname, 'fixture/source-map-file.js')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('stack traces for exceptions are corrected using a source map file in what looks like a browser env', t => {
	t.plan(4);

	const api = apiCreator({
		cacheEnabled: true
	});

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'uncaught-exception') {
				t.match(evt.err.message, /Thrown by source-map-fixtures/);
				t.match(evt.err.stack, /^.*?Object\.t.*?as run\b.*source-map-fixtures.src.throws.js:1.*$/m);
				t.match(evt.err.stack, /^.*?Immediate\b.*source-map-file-browser-env.js:7.*$/m);
			}
		});
	});

	return api.run([path.join(__dirname, 'fixture/source-map-file-browser-env.js')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('enhanced assertion formatting necessary whitespace and empty strings', t => {
	const expected = [
		[
			/foo === "" && "" === foo/,
			/foo === ""/,
			/foo/
		],
		[
			/new Object\(foo\) instanceof Object/,
			/Object/,
			/new Object\(foo\)/,
			/foo/
		],
		[
			/\[foo].filter\(item => {\n\s+return item === "bar";\n}\).length > 0/,
			/\[foo].filter\(item => {\n\s+return item === "bar";\n}\).length/,
			/\[foo].filter\(item => {\n\s+return item === "bar";\n}\)/,
			/\[foo]/,
			/foo/
		]
	];

	t.plan(14);
	const api = apiCreator();
	const errors = [];
	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'test-failed') {
				errors.push(evt.err);
			}
		});
	});
	return api.run([path.join(__dirname, 'fixture/enhanced-assertion-formatting.js')])
		.then(runStatus => {
			t.is(errors.length, 3);
			t.is(runStatus.stats.passedTests, 0);

			errors.forEach((error, errorIndex) => {
				error.statements.forEach((statement, statementIndex) => {
					t.match(statement[0], expected[errorIndex][statementIndex]);
				});
			});
		});
});

test('stack traces for exceptions are corrected using a source map file (cache off)', t => {
	t.plan(4);

	const api = apiCreator({
		cacheEnabled: false
	});

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'uncaught-exception') {
				t.match(evt.err.message, /Thrown by source-map-fixtures/);
				t.match(evt.err.stack, /^.*?Object\.t.*?as run\b.*source-map-fixtures.src.throws.js:1.*$/m);
				t.match(evt.err.stack, /^.*?Immediate\b.*source-map-file.js:4.*$/m);
			}
		});
	});

	return api.run([path.join(__dirname, 'fixture/source-map-file.js')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('stack traces for exceptions are corrected using a source map, taking an initial source map for the test file into account (cache on)', t => {
	t.plan(4);

	const api = apiCreator({
		cacheEnabled: true
	});

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'uncaught-exception') {
				t.match(evt.err.message, /Thrown by source-map-fixtures/);
				t.match(evt.err.stack, /^.*?Object\.t.*?as run\b.*source-map-fixtures.src.throws.js:1.*$/m);
				t.match(evt.err.stack, /^.*?Immediate\b.*source-map-initial-input.js:14.*$/m);
			}
		});
	});

	return api.run([path.join(__dirname, 'fixture/source-map-initial.js')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('stack traces for exceptions are corrected using a source map, taking an initial source map for the test file into account (cache off)', t => {
	t.plan(4);

	const api = apiCreator({
		cacheEnabled: false
	});

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'uncaught-exception') {
				t.match(evt.err.message, /Thrown by source-map-fixtures/);
				t.match(evt.err.stack, /^.*?Object\.t.*?as run\b.*source-map-fixtures.src.throws.js:1.*$/m);
				t.match(evt.err.stack, /^.*?Immediate\b.*source-map-initial-input.js:14.*$/m);
			}
		});
	});

	return api.run([path.join(__dirname, 'fixture/source-map-initial.js')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('absolute paths', t => {
	const api = apiCreator();

	return api.run([path.resolve('test/fixture/es2015.js')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('symlink to directory containing test files', t => {
	const api = apiCreator();

	return api.run([path.join(__dirname, 'fixture/symlink')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('symlink to test file directly', t => {
	const api = apiCreator();

	return api.run([path.join(__dirname, 'fixture/symlinkfile.js')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('search directories recursively for files', t => {
	const api = apiCreator();

	return api.run([path.join(__dirname, 'fixture/subdir')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 2);
			t.is(runStatus.stats.failedTests, 1);
		});
});

test('test file in node_modules is ignored', t => {
	t.plan(1);

	const api = apiCreator();
	return api.run([path.join(__dirname, 'fixture/ignored-dirs/node_modules/test.js')])
		.then(runStatus => {
			t.is(runStatus.stats.declaredTests, 0);
		});
});

test('test file in fixtures is ignored', t => {
	t.plan(1);

	const api = apiCreator();
	return api.run([path.join(__dirname, 'fixture/ignored-dirs/fixtures/test.js')])
		.then(runStatus => {
			t.is(runStatus.stats.declaredTests, 0);
		});
});

test('test file in helpers is ignored', t => {
	t.plan(1);

	const api = apiCreator();
	return api.run([path.join(__dirname, 'fixture/ignored-dirs/helpers/test.js')])
		.then(runStatus => {
			t.is(runStatus.stats.declaredTests, 0);
		});
});

test('Node.js-style --require CLI argument', t => {
	const requirePath = './' + path.relative('.', path.join(__dirname, 'fixture/install-global.js')).replace(/\\/g, '/');

	const api = apiCreator({
		require: [requirePath]
	});

	return api.run([path.join(__dirname, 'fixture/validate-installed-global.js')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('Node.js-style --require CLI argument module not found', t => {
	t.throws(() => {
		/* eslint no-new: 0 */
		apiCreator({require: ['foo-bar']});
	}, /^Could not resolve required module 'foo-bar'$/);
	t.end();
});

test('caching is enabled by default', t => {
	del.sync(path.join(__dirname, 'fixture/caching/node_modules'));

	const api = apiCreator({
		projectDir: path.join(__dirname, 'fixture/caching')
	});

	return api.run([path.join(__dirname, 'fixture/caching/test.js')])
		.then(() => {
			const files = fs.readdirSync(path.join(__dirname, 'fixture/caching/node_modules/.cache/ava'));
			t.ok(files.length, 4);
			t.is(files.filter(x => endsWithBin(x)).length, 1);
			t.is(files.filter(x => endsWithJs(x)).length, 2);
			t.is(files.filter(x => endsWithMap(x)).length, 1);
		});

	function endsWithBin(filename) {
		return /\.bin$/.test(filename);
	}

	function endsWithJs(filename) {
		return /\.js$/.test(filename);
	}

	function endsWithMap(filename) {
		return /\.map$/.test(filename);
	}
});

test('caching can be disabled', t => {
	del.sync(path.join(__dirname, 'fixture/caching/node_modules'));

	const api = apiCreator({
		resolveTestsFrom: path.join(__dirname, 'fixture/caching'),
		cacheEnabled: false
	});

	return api.run([path.join(__dirname, 'fixture/caching/test.js')])
		.then(() => {
			t.false(fs.existsSync(path.join(__dirname, 'fixture/caching/node_modules/.cache/ava')));
		});
});

test('test file with only skipped tests does not create a failure', t => {
	const api = apiCreator();

	return api.run([path.join(__dirname, 'fixture/skip-only.js')])
		.then(runStatus => {
			t.is(runStatus.stats.selectedTests, 1);
			t.is(runStatus.stats.skippedTests, 1);
			t.is(runStatus.stats.failedTests, 0);
		});
});

test('test file with only skipped tests does not run hooks', t => {
	const api = apiCreator();

	return api.run([path.join(__dirname, 'fixture/hooks-skipped.js')])
		.then(runStatus => {
			t.is(runStatus.stats.selectedTests, 1);
			t.is(runStatus.stats.skippedTests, 1);
			t.is(runStatus.stats.passedTests, 0);
			t.is(runStatus.stats.failedTests, 0);
			t.is(runStatus.stats.failedHooks, 0);
		});
});

test('emits dependencies for test files', t => {
	t.plan(8);

	const api = apiCreator({
		require: [path.resolve('test/fixture/with-dependencies/require-custom.js')]
	});

	const testFiles = [
		path.resolve('test/fixture/with-dependencies/no-tests.js'),
		path.resolve('test/fixture/with-dependencies/test.js'),
		path.resolve('test/fixture/with-dependencies/test-failure.js'),
		path.resolve('test/fixture/with-dependencies/test-uncaught-exception.js')
	];

	const sourceFiles = [
		path.resolve('test/fixture/with-dependencies/dep-1.js'),
		path.resolve('test/fixture/with-dependencies/dep-2.js'),
		path.resolve('test/fixture/with-dependencies/dep-3.custom')
	];

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'dependencies') {
				t.notEqual(testFiles.indexOf(evt.testFile), -1);
				t.strictDeepEqual(evt.dependencies.slice(-3), sourceFiles);
			}
		});
	});

	return api.run(['test/fixture/with-dependencies/*test*.js']);
});

test('verify test count', t => {
	t.plan(4);

	const api = apiCreator();

	return api.run([
		path.join(__dirname, 'fixture/test-count.js'),
		path.join(__dirname, 'fixture/test-count-2.js'),
		path.join(__dirname, 'fixture/test-count-3.js')
	]).then(runStatus => {
		t.is(runStatus.stats.passedTests, 4, 'pass count');
		t.is(runStatus.stats.failedTests, 3, 'fail count');
		t.is(runStatus.stats.skippedTests, 3, 'skip count');
		t.is(runStatus.stats.todoTests, 3, 'todo count');
	});
});

test('babel.testOptions with a custom plugin', t => {
	t.plan(2);

	const api = apiCreator({
		babelConfig: {
			testOptions: {
				plugins: [testCapitalizerPlugin]
			}
		},
		cacheEnabled: false,
		projectDir: __dirname
	});

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'test-passed') {
				t.is(evt.title, 'FOO');
			}
		});
	});

	return api.run([path.join(__dirname, 'fixture/babelrc/test.js')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		}, t.threw);
});

test('babel.testOptions.babelrc effectively defaults to true', t => {
	t.plan(3);

	const api = apiCreator({
		projectDir: path.join(__dirname, 'fixture/babelrc')
	});

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'test-passed') {
				t.ok((evt.title === 'foo') || (evt.title === 'repeated test: foo'));
			}
		});
	});

	return api.run()
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 2);
		});
});

test('babel.testOptions.babelrc can explicitly be true', t => {
	t.plan(3);

	const api = apiCreator({
		babelConfig: {
			testOptions: {babelrc: true}
		},
		cacheEnabled: false,
		projectDir: path.join(__dirname, 'fixture/babelrc')
	});

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'test-passed') {
				t.ok(evt.title === 'foo' || evt.title === 'repeated test: foo');
			}
		});
	});

	return api.run()
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 2);
		});
});

test('babel.testOptions.babelrc can explicitly be false', t => {
	t.plan(2);

	const api = apiCreator({
		babelConfig: {
			testOptions: {babelrc: false}
		},
		cacheEnabled: false,
		projectDir: path.join(__dirname, 'fixture/babelrc')
	});

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'test-passed') {
				t.is(evt.title, 'foo');
			}
		});
	});

	return api.run()
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});

test('babelConfig.testOptions merges plugins with .babelrc', t => {
	t.plan(3);

	const api = apiCreator({
		babelConfig: {
			testOptions: {
				babelrc: true,
				plugins: [testCapitalizerPlugin]
			}
		},
		cacheEnabled: false,
		projectDir: path.join(__dirname, 'fixture/babelrc')
	});

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'test-passed') {
				t.ok(evt.title === 'FOO' || evt.title === 'repeated test: foo');
			}
		});
	});

	return api.run()
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 2);
		});
});

test('babelConfig.testOptions with extends still merges plugins with .babelrc', t => {
	t.plan(3);

	const api = apiCreator({
		babelConfig: {
			testOptions: {
				plugins: [testCapitalizerPlugin],
				extends: path.join(__dirname, 'fixture/babelrc/.alt-babelrc')
			}
		},
		cacheEnabled: false,
		projectDir: path.join(__dirname, 'fixture/babelrc')
	});

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'test-passed') {
				t.ok(evt.title === 'BAR' || evt.title === 'repeated test: bar');
			}
		});
	});

	return api.run()
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 2);
		});
});

test('using --match with matching tests will only report those passing tests', t => {
	t.plan(3);

	const api = apiCreator({
		match: ['this test will match']
	});

	api.on('run', plan => {
		plan.status.on('stateChange', evt => {
			if (evt.type === 'selected-test') {
				t.match(evt.testFile, /match-no-match-2/);
				t.is(evt.title, 'this test will match');
			}
		});
	});

	return api.run([
		path.join(__dirname, 'fixture/match-no-match.js'),
		path.join(__dirname, 'fixture/match-no-match-2.js'),
		path.join(__dirname, 'fixture/test-count.js')
	]).then(runStatus => {
		t.is(runStatus.stats.passedTests, 1);
	});
});

function generatePassDebugTests(env, execArgv, expectedPort) {
	test(`pass ${execArgv.join(' ')} to fork`, t => {
		const flag = Number(process.version.split('.')[0].slice(1)) < 8 ? 'debug' : 'inspect';
		const api = apiCreator({testOnlyEnv: env, testOnlyExecArgv: execArgv});
		return api._computeForkExecArgv()
			.then(result => {
				t.true(result.length === 1);
				t.true(new RegExp(`--${flag}=\\d+`).test(result[0]));
				if (expectedPort !== -1) {
					t.is(result[0], `--${flag}=${expectedPort}`);
				}
			});
	});
}

function generatePassDebugIntegrationTests(env, execArgv) {
	test(`pass ${execArgv.join(' ')} to fork`, t => {
		const flag = Number(process.version.split('.')[0].slice(1)) < 8 ? 'debug' : 'inspect';
		const api = apiCreator({testOnlyEnv: env, testOnlyExecArgv: execArgv});
		return api.run([path.join(__dirname, `fixture/${flag}-arg.js`)])
			.then(runStatus => {
				t.is(runStatus.stats.passedTests, 1);
			});
	});
}

generatePassDebugTests({}, ['--debug=9229'], 9229);
generatePassDebugTests({}, ['--debug=0'], -1);
generatePassDebugTests({}, ['--debug=x'], -1);
generatePassDebugTests({}, ['--debug'], -1);

generatePassDebugTests({}, ['--inspect=9229'], 9229);
generatePassDebugTests({}, ['--inspect=0'], -1);
generatePassDebugTests({}, ['--inspect=x'], -1);
generatePassDebugTests({}, ['--inspect'], -1);

// Env takes precedence over args
generatePassDebugTests({NODE_DEBUG_OPTION: '--debug=9229'}, ['--debug=2992'], 9229);
generatePassDebugTests({NODE_DEBUG_OPTION: '--inspect=9229'}, ['--inspect=2992'], 9229);

// Within args, last one takes precedence
generatePassDebugTests({}, ['--debug-brk=2992', '--inspect=9229'], 9229);
generatePassDebugTests({}, ['--inspect-brk=2992', '--debug=9229'], 9229);

generatePassDebugIntegrationTests({}, ['--debug=9229']);
generatePassDebugIntegrationTests({}, ['--debug']);
generatePassDebugIntegrationTests({}, ['--inspect=9229']);
generatePassDebugIntegrationTests({}, ['--inspect']);

test('`esm` package support', t => {
	const api = apiCreator({
		require: [require.resolve('esm')]
	});

	return api.run([path.join(__dirname, 'fixture/esm-pkg/test.js')])
		.then(runStatus => {
			t.is(runStatus.stats.passedTests, 1);
		});
});
