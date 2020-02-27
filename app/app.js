const {configUtils, utils} = require('./utils');
const LogDelivery = require('./log-delivery');
const OpenshiftCli = require('./openshift-cli');

const state = {
    isShutdown: false
};


configUtils.verify();

const logDelivery = new LogDelivery();
const openshiftCli = new OpenshiftCli();

const work = async () => {
    while (!state.isShutdown) {
        console.log(`Start processing...`);
        const startTime = new Date().getTime();
        const batch = openshiftCli.getLogs();
        // send items to transport...
        logDelivery.deliver(batch, {env: configUtils.pollInterval()});

        const elapsedTime = new Date().getTime() - startTime;
        console.log(`End processing... elapsed time (ms) ${elapsedTime}`);

        // sleep for poll interval less our processing time, or half of poll interval if processing was LOOOOONG...
        const waitTime = Math.max(configUtils.pollInterval() - elapsedTime, configUtils.pollInterval() / 2);
        console.log(`Wait for ${waitTime} (ms)...`);
        await utils.sleep(waitTime);
    }
};

if (openshiftCli.connect()) {
    work();
}

// Prevent unhandled errors from crashing application
process.on('unhandledRejection', err => {
    if (err && err.stack) {
        console.log(err.stack);
    }
});

// Graceful shutdown support
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
    console.log(`Received kill signal. Shutting down in ${configUtils.pollInterval()} ms`);
    state.isShutdown = true;
    // Wait before hard exiting
    setTimeout(() => process.exit(), configUtils.pollInterval());
}
