const moment = require('moment');

const Constants = Object.freeze({
    pollInterval: 'LOGAPP_POLL_INTERVAL',
    namespace: 'LOGAPP_NAMESPACE',
    podName: 'LOGAPP_POD_NAME',
    containerName: 'LOGAPP_CONTAINER_NAME',
    selector: 'LOGAPP_SELECTOR',
    limitBytes: 'LOGAPP_LIMIT_BYTES',
    sinceTime: 'LOGAPP_SINCE_TIME',
    consoleUrl: 'LOGAPP_CONSOLE_URL',
    token: 'LOGAPP_TOKEN'
});

const configUtils = {

    verify: () => {
        let podSelector = false;
        let mandatory = false;
        try {
            podSelector = (stringUtils.isNotEmpty(configUtils.podName()) &&
                stringUtils.isNotEmpty(configUtils.containerName())) ||
                stringUtils.isNotEmpty(configUtils.selector());
            mandatory = configUtils.pollInterval() > 0 && stringUtils.isNotEmpty(configUtils.namespace());
        } catch (e) {
            //
        }
        if (podSelector && mandatory) {
            return true;
        } else {
            const msgs = ['Configuration error'];
            if (!podSelector) {
                msgs.push('Either podName & containerName - or - selector required.');
                msgs.push(`podName(${Constants.podName}) = ${process.env[Constants.podName]}`);
                msgs.push(`containerName(${Constants.containerName}) = ${process.env[Constants.containerName]}`);
                msgs.push(`selector(${Constants.selector}) = ${process.env[Constants.selector]}`);
            }
            if (!mandatory) {
                msgs.push('Both pollInterval and namespace are  required.');
                msgs.push(`pollInterval(${Constants.pollInterval}) = ${process.env[Constants.pollInterval]}`);
                msgs.push(`namespace(${Constants.namespace}) = ${process.env[Constants.namespace]}`);
            }
            throw Error(msgs.join('\n'));
        }
    },

    pollInterval: () => {
        return envParser.getInt(Constants.pollInterval, 30000);
    },

    namespace: () => {
        return envParser.getString(Constants.namespace);
    },

    podName: () => {
        return envParser.getString(Constants.podName);
    },

    containerName: () => {
        return envParser.getString(Constants.containerName);
    },

    selector: () => {
        return envParser.getString(Constants.selector);
    },

    limitBytes: () => {
        return envParser.getInt(Constants.limitBytes, 50000);
    },

    sinceTime: () => {
        return envParser.getTimestamp(Constants.sinceTime, moment().subtract(15, 'minutes').toISOString());
    },

    consoleUrl: () => {
        return envParser.getString(Constants.consoleUrl);
    },

    token: () => {
        return envParser.getString(Constants.token);
    }
};

const envParser = {
    getString: (name, defaultValue = '') => {
        if (process.env[name] && process.env[name].trim().length) {
            return process.env[name].trim();
        }
        return defaultValue;
    },

    getInt: (name, defaultValue = 0) => {
        try {
            return parseInt(process.env[name]) || defaultValue;
        } catch (e) {
            return defaultValue;
        }
    },

    getTimestamp: (name, defaultValue) => {
        try {
            const ts = moment(process.env[name]);
            if (ts.isValid()) {
                return moment(process.env[name]).toISOString();
            }
            return defaultValue;
        } catch (e) {
            return defaultValue;
        }
    }
};

const stringUtils = {
    isEmpty: s => {
        if (Object.prototype.toString.call(s) === '[object String]') {
            return s.trim().length === 0;
        }
        return false;
    },

    isNotEmpty: s => {
        return !stringUtils.isEmpty(s);
    }

};

const utils = {
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
};

module.exports = {configUtils, envParser, stringUtils, utils};
