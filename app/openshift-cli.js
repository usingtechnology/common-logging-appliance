const {spawnSync} = require('child_process');
const moment = require('moment');

const {configUtils, stringUtils} = require('./utils');

const SPAWN_OPTS = {
    encoding: 'UTF-8',
    cwd: process.cwd(),
    env: process.env
};

const isEmpty = s => {
    return stringUtils.isEmpty(s);
};

const isNotEmpty = s => {
    return stringUtils.isNotEmpty(s);
};

const hasOption = (options, ...args) => {
    return args.every(a => {
        return options && options[a] && isNotEmpty(options[a]);
    });
};

const parseLine = (line, namespace, pod, container) => {
    let result = {
        metadata: {
            oclog: {
                namespace: namespace,
                pod: pod,
                container: container,
                timestamp: '',
                time: 0
            }
        },
        message: ''
    };
    if (!line) {
        return result;
    }

    let zed = line.indexOf('Z');
    if (zed > -1) {
        const ts = line.slice(0, zed + 1).trim();
        let msg = line.slice(zed + 1);
        if (msg) {
            msg = msg.trim();
            // remove any control sequences or ascii color...
            // eslint-disable-next-line no-control-regex
            msg = msg.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
        }
        result.metadata.oclog = {...result.metadata.oclog, ...{timestamp: ts, time: moment(ts).valueOf()}};
        result = {...result, ...{message: msg ? msg : ''}};
    }
    return result;
};

const parseOcLogs = (oclogs, namespace, pod, container) => {
    let batch = [];
    if (oclogs && oclogs.status === 0 && oclogs.stdout) {
        try {
            // find last full line, split there, we do not want partial log lines (due to limitBytes)...
            const logs = oclogs.stdout.slice(0, oclogs.stdout.lastIndexOf('\n'));
            const lines = logs.split('\n');
            batch = lines.map(l => parseLine(l, namespace, pod, container));
        } catch (e) {
            console.log(`Error parsing logs from oc logs. ${e.message}`);
        }
    }
    // only want items that have a timestamp, empty message bodies will be filtered later.
    // we need to process lines without messages, so we can determine first/last timestamp and set our log query window.
    batch = batch.filter(l => {
        return l.metadata.oclog.time !== 0;
    });
    return batch;
};


class OpenshiftCli {
    constructor() {
        this._namespace = configUtils.namespace();
        this._podName = configUtils.podName();
        this._containerName = configUtils.containerName();
        this._selector = configUtils.selector();
        this._limitBytes = configUtils.limitBytes();
        this._sinceTime = configUtils.sinceTime();
        this._consoleUrl = configUtils.consoleUrl();
        this._token = configUtils.token();

        // build a list of pods
        // { podName, containerName, firstTimestamp, lastTimestamp, selector }
        this._pods = [];
    }

    connect() {
        // do a who am i, when running in openshift, should return success...
        const whoAmi = spawnSync('oc', ['whoami'], SPAWN_OPTS);
        let loggedIn = whoAmi.status === 0;
        console.log(`Openshift whoami? ${loggedIn ? whoAmi.stdout.trim() : whoAmi.stderr.trim()}`);

        // if running locally, we probably have to login (need a current token)
        // we do not expect this to be used when running in Openshift.
        if (!loggedIn && isNotEmpty(this._consoleUrl) && isNotEmpty(this._token)) {
            const signin = spawnSync('oc', ['login', this._consoleUrl, `--token=${this._token}`], SPAWN_OPTS);
            loggedIn = signin.status === 0;
            console.log(`Openshift login attempt to ${this._consoleUrl}. ${loggedIn ? 'success!' : signin.stderr.trim()}`);
        }

        // ok, check to see that logged in account can read pod logs...
        let readLogs = false;
        if (loggedIn) {
            const checkPrivilege = spawnSync('oc', ['-n', this._namespace, 'auth', 'can-i', 'get', 'pods', '--subresource=log'], SPAWN_OPTS);
            readLogs = checkPrivilege.status === 0 && checkPrivilege.stdout.trim() === 'yes';
            console.log(`Openshift check privileges to read pod logs in namespace ${this._namespace}: ${readLogs ? checkPrivilege.stdout.trim() : checkPrivilege.stderr.trim()}`);
        }
        return loggedIn && readLogs;
    }

    getPods() {
        const podHistory = [...this._pods];
        this._pods = [];
        if (isNotEmpty(this._podName) && isNotEmpty(this._containerName)) {
            this._pods.push({
                podName: this._podName,
                containerName: this._containerName,
                firstTimestamp: '',
                lastTimestamp: '',
                selector: '-'
            });
        } else {
            // get pod names by selector...
            const selector = spawnSync('oc', ['-n', this._namespace, 'get', 'pods', `--selector=${this._selector}`, '--output=json'], SPAWN_OPTS);
            const gotSelected = selector.status === 0;
            console.log(`Openshift select pods in ${this._namespace} by selector ${this._selector}: ${gotSelected ? 'success!' : selector.stderr.trim()}`);
            if (gotSelected) {
                const obj = JSON.parse(selector.stdout.trim());
                obj.items.forEach(o => {
                    const p = {
                        podName: o.metadata.name,
                        containerName: o.spec.containers[0].name,
                        firstTimestamp: '',
                        lastTimestamp: '',
                        selector: this._selector
                    };
                    this._pods.push(p);
                });
            }
        }


        this._pods.forEach(p => {
            // check to see if these pods are the same as before, we can scoop the metadata
            const history = podHistory.find(h => h.podName === p.podName);
            if (history) {
                p.firstTimestamp = history.firstTimestamp;
                p.lastTimestamp = history.lastTimestamp;
            } else {
                const logs = spawnSync('oc', ['-n', this._namespace, 'logs', p.podName, '-c', p.containerName, '--timestamps', '--limit-bytes=100'], SPAWN_OPTS);
                const gotLogs = logs.status === 0;
                console.log(`Openshift get logs for ${p.podName}: ${gotLogs ? 'success!' : logs.stderr.trim()}`);
                if (gotLogs) {
                    const batch = parseOcLogs(logs, this._namespace, p.podName, p.containerName);
                    if (batch.length) {
                        p.firstTimestamp = batch[0].metadata.oclog.timestamp;
                    }
                }
            }
        });

        // strip out any pods we couldn't get logs for?
        this._pods = this._pods.filter(p => {
            return p.firstTimestamp !== '';
        });
        const result = this._pods.length;
        console.log(`Monitoring ${this._pods.length} Pods.`);
        if (result) {
            this._pods.forEach(p => {
                console.log(JSON.stringify(p));
            });

        } else {
            const details = this._podName && this._containerName ? `Pod (${this._podName}) and Container (${this._containerName})` : `Selector = ${this._selector}`;
            console.log(`No logs found in ${this._namespace} for ${details}`);
        }
        return result;
    }

    getLogs() {
        let hasPods = this._pods.length > 0;
        let batch = [];
        // if we are running, and we've built our list of pods from a selector, then we should refresh continually... pods come up and down...
        if (isEmpty(this._podName) || !hasPods) {
            hasPods = this.getPods();
        }

        if (hasPods) {
            // take the configured byte limit and divide across all pods...
            const podByteLimit = Math.trunc(this._limitBytes / this._pods.length);
            this._pods.forEach(p => {
                const sinceTime = p.lastTimestamp ? p.lastTimestamp : this._sinceTime;
                const logs = spawnSync('oc', ['-n', this._namespace, 'logs', p.podName, '-c', p.containerName, '--timestamps', `--limit-bytes=${podByteLimit}`, `--since-time=${sinceTime}`], SPAWN_OPTS);
                const gotLogs = logs.status === 0;
                console.log(`Openshift get logs for ${p.podName} since ${sinceTime}: ${gotLogs ? 'success!\'' : logs.stderr.trim()}`);
                if (gotLogs) {
                    const podBatch = parseOcLogs(logs, this._namespace, p.podName, p.containerName);
                    if (podBatch.length) {
                        // item with our lastTimestamp has been sent, remove it.
                        let items = podBatch.filter(item => {
                            return item.metadata.oclog.timestamp !== p.lastTimestamp;
                        });

                        // set the last timestamp
                        const maxTs = Math.max(...items.map(o => o.metadata.oclog.time), 0);
                        const lastItem = items.find(item => item.metadata.oclog.time === maxTs);
                        p.lastTimestamp = lastItem.metadata.oclog.timestamp;

                        console.log(`Pod (${p.podName}) batch size is ${items.length}.`);
                        batch = batch.concat(items);
                    }
                }
            });

            // now sort by timestamp asc
            batch.sort((a, b) => a.metadata.oclog.time - b.metadata.oclog.time);

        }
        console.log(`Log batch size is ${batch.length}.`);
        return batch;
    }

}

module.exports = OpenshiftCli;
