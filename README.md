# Nextcloud Cloudron App

This repository contains the Cloudron app package source for [Nextcloud](https://nextcloud.com).

## Installation

[![Install](https://cloudron.io/img/button.svg)](https://cloudron.io/button.html?app=com.nextcloud.cloudronapp)

or using the [Cloudron command line tooling](https://cloudron.io/references/cli.html)

```
cloudron install --appstore-id com.nextcloud.cloudronapp
```

## Building

The app package can be built using the [Cloudron command line tooling](https://cloudron.io/references/cli.html).

```
cd nextcloud-app
cloudron build
cloudron install
```

## Testing

The e2e tests are located in the `test/` folder and require [nodejs](http://nodejs.org/). They are creating a fresh build, install the app on your Cloudron, verify auth, upload a file, backup, restore and verify the file still being present.

```
cd nextcloud-app/test

npm install
USERNAME=<cloudron username> PASSWORD=<cloudron password> mocha test.js
```

## Debugging

Change loglevel to 0 (in config.php / start.sh)



