#!/usr/bin/env node

'use strict';

var execSync = require('child_process').execSync,
    expect = require('expect.js'),
    fs = require('fs'),
    path = require('path'),
    request = require('request'),
    superagent = require('superagent'),
    util = require('util'),
    manifest = require('../CloudronManifest.json'),
    webdriver = require('selenium-webdriver');

var by = require('selenium-webdriver').By,
    until = require('selenium-webdriver').until;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

if (!process.env.USERNAME || !process.env.PASSWORD) {
    console.log('USERNAME and PASSWORD env vars need to be set');
    process.exit(1);
}

describe('Application life cycle test', function () {
    this.timeout(0);

    var firefox = require('selenium-webdriver/firefox');
    var server, browser = new firefox.Driver();
    var TEST_TIMEOUT = 20000;
    var LOCATION = 'owncloudtest';
    var LOCAL_FILENAME = 'sticker.png';
    var REMOTE_FILENAME = 'sticker.png';
    var CONTACT_NAME = 'Johannes';
    var app;
    var username = process.env.USERNAME;
    var password = process.env.PASSWORD;
    var adminUser = 'admin';
    var adminPassword = 'changeme';

    before(function (done) {
        if (!process.env.USERNAME) return done(new Error('USERNAME env var not set'));
        if (!process.env.PASSWORD) return done(new Error('PASSWORD env var not set'));

        var seleniumJar= require('selenium-server-standalone-jar');
        var SeleniumServer = require('selenium-webdriver/remote').SeleniumServer;
        server = new SeleniumServer(seleniumJar.path, { port: 4444 });
        server.start();

        done();
    });

    after(function (done) {
        browser.quit();
        server.stop();
        done();
    });

    function testFileDownload(callback) {
        var data = {
            url: util.format('https://%s/remote.php/webdav/%s', app.fqdn, REMOTE_FILENAME),
            auth: { username: username, password: password },
            encoding: 'binary'
        };

        request.get(data, function (error, response, body) {
            if (error !== null) return callback(error);
            if (response.statusCode !== 200) return callback('Status code: ' + response.statusCode);
            if (body !== fs.readFileSync(path.resolve(LOCAL_FILENAME)).toString('binary')) return callback('File corrupt');

            callback(null);
        });
    }

    function login(username, password, callback) {
        browser.get('https://' + app.fqdn);

        browser.wait(until.elementLocated(by.xpath('//input[@name="user"]')), TEST_TIMEOUT);
        browser.wait(until.elementIsVisible(browser.findElement(by.xpath('//input[@name="user"]'))), TEST_TIMEOUT);

        browser.findElement(by.xpath('//input[@name="user"]')).sendKeys(username);
        browser.findElement(by.xpath('//input[@name="password"]')).sendKeys(password);
        browser.findElement(by.tagName('form')).submit();

        browser.wait(until.elementLocated(by.xpath('//*[@id="expand"]')), TEST_TIMEOUT);
        browser.wait(until.elementIsVisible(browser.findElement(by.xpath('//*[@id="expand"]'))), TEST_TIMEOUT).then(function () { callback(); });
    }

    function logout(callback) {
        browser.get('https://' + app.fqdn);

        browser.wait(until.elementLocated(by.xpath('//*[@id="expand"]')), TEST_TIMEOUT);
        browser.wait(until.elementIsVisible(browser.findElement(by.xpath('//*[@id="expand"]'))), TEST_TIMEOUT);
        browser.findElement(by.xpath('//*[@id="expand"]')).click();
        browser.wait(until.elementIsVisible(browser.findElement(by.id('logout'))), TEST_TIMEOUT);
        browser.findElement(by.id('logout')).click();
        browser.wait(until.elementLocated(by.xpath('//input[@name="user"]')), TEST_TIMEOUT).then(function () { callback(); });
    }

    function closeWizard(callback) {
        browser.get('https://' + app.fqdn);

        browser.wait(until.elementLocated(by.id('closeWizard')), TEST_TIMEOUT);
        browser.wait(until.elementIsVisible(browser.findElement(by.id('closeWizard'))), TEST_TIMEOUT);
        browser.findElement(by.id('closeWizard')).click();
        browser.wait(until.elementLocated(by.id('filestable')), TEST_TIMEOUT);

        // give it some time to save
        browser.sleep(8000).then(function () { callback(); });
    }

    function getContact(callback) {
        browser.get('https://' + app.fqdn + '/index.php/apps/contacts');

        // give it some time to save
        browser.sleep(8000);

        browser.wait(until.elementLocated(by.xpath('//div[text()="' + CONTACT_NAME + '"]')), TEST_TIMEOUT).then(function () { callback(); });
    }

    function apiLogin(callback) {
        superagent.get('https://' + app.fqdn + '/ocs/v1.php/cloud/users/' + username).auth(username, password).end(function (error, result) {
            if (error !== null) return callback(error);
            if (result.statusCode !== 200) return callback('Status code: ' + result.statusCode);

            callback();
        });
    }

    xit('build app', function () {
        execSync('cloudron build', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    });

    it('install app', function () {
        execSync('cloudron install --new --wait --location ' + LOCATION, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    });

    it('can get app information', function () {
        var inspect = JSON.parse(execSync('cloudron inspect'));

        app = inspect.apps.filter(function (a) { return a.location === LOCATION; })[0];

        expect(app).to.be.an('object');
    });

    it('check scheduler script', function () {
        var output = execSync('cloudron exec -i -- ls -l ' + manifest.addons.scheduler.housekeeping.command);
        expect(output.indexOf('-rwxrwxr-x')).to.be.greaterThan(-1);
    });

    it('can login', login.bind(null, username, password));
    it('can close the wizard', closeWizard);
    it('can logout', logout);

    it('can upload file', function (done) {
        // was unable to upload the file correctly using node, too much time wasted...
        var cmd = util.format('curl --insecure -X PUT -u %s:%s "https://%s/remote.php/webdav/%s" --data-binary @"./%s"', username, password, app.fqdn, REMOTE_FILENAME, LOCAL_FILENAME);
        execSync(cmd);
        done();
    });

    it('can download previously uploaded file', testFileDownload);
    it('can api login', apiLogin);

    it('can login as admin', login.bind(null, adminUser, adminPassword));
    it('can close wizard', closeWizard);

    it('can enable contacts app', function (done) {
        browser.get('https://' + app.fqdn + '/index.php/settings/apps');

        // open productivity category
        browser.wait(until.elementLocated(by.xpath('//*[@id="app-category-productivity"]')), TEST_TIMEOUT);
        browser.findElement(by.xpath('//*[@id="app-category-productivity"]')).click();

        // enable contacts
        browser.wait(until.elementLocated(by.xpath('//*[@id="app-168708"]/input[2]')), TEST_TIMEOUT);
        browser.findElement(by.xpath('//*[@id="app-168708"]/input[2]')).click();

        // wait for the app being present in the grid
        browser.wait(until.elementLocated(by.xpath('//li[@data-id="contacts"]')), 20000).then(function () { done(); });
    });

    it('can add contact', function (done) {
        browser.get('https://' + app.fqdn + '/index.php/apps/contacts');

        browser.sleep(4000);

        // click new contact
        browser.wait(until.elementLocated(by.className('app-content-list-button')), TEST_TIMEOUT);
        browser.wait(until.elementIsVisible(browser.findElement(by.className('app-content-list-button'))), TEST_TIMEOUT);
        browser.findElement(by.className('app-content-list-button')).click();

        // add new contact
        browser.wait(until.elementLocated(by.xpath('//*[@id="details-fullName"]')), TEST_TIMEOUT);
        browser.wait(until.elementIsVisible(browser.findElement(by.xpath('//*[@id="details-fullName"]'))), TEST_TIMEOUT);
        browser.findElement(by.xpath('//*[@id="details-fullName"]')).sendKeys(CONTACT_NAME);
        browser.findElement(by.xpath('//*[@id="details-fullName"]')).sendKeys(webdriver.Key.TAB);

        // give it some time to save
        browser.sleep(8000).then(function () { done(); });
    });

    it('can get contact', getContact);
    it('can logout', logout);

    it('can restart app', function (done) {
        execSync('cloudron restart');
        done();
    });

    it('can login', login.bind(null, username, password));
    it('can logout', logout);
    it('can admin login', login.bind(null, adminUser, adminPassword));
    it('can get contact', getContact);
    it('can download previously uploaded file', testFileDownload);
    it('can api login', apiLogin);

    it('backup app', function () {
        execSync('cloudron backup --app ' + app.id, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    });

    it('restore app', function () {
        execSync('cloudron restore --app ' + app.id, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    });

    it('can login', login.bind(null, username, password));
    it('can logout', logout);
    it('can admin login', login.bind(null, adminUser, adminPassword));
    it('can get contact', getContact);
    it('can download previously uploaded file', testFileDownload);
    it('can api login', apiLogin);

    it('move to different location', function () {
        browser.manage().deleteAllCookies();
        execSync('cloudron install --location ' + LOCATION + '2', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
        var inspect = JSON.parse(execSync('cloudron inspect'));
        app = inspect.apps.filter(function (a) { return a.location === LOCATION + '2'; })[0];
        expect(app).to.be.an('object');
    });

    it('can login', login.bind(null, adminUser, adminPassword));
    it('can logout', logout);
    it('can admin login', login.bind(null, adminUser, adminPassword));
    it('can get contact', getContact);
    it('can download previously uploaded file', testFileDownload);
    it('can api login', apiLogin);

    it('uninstall app', function () {
        execSync('cloudron uninstall --app ' + app.id, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    });
});
