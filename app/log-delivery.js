const axios = require('axios');
const oauth = require('axios-oauth-client');
const tokenProvider = require('axios-token-interceptor');

const {envParser, stringUtils} = require('./utils');

const Constants = Object.freeze({
    tokenUrl: 'CMNSRV_TOKENURL',
    clientId: 'CMNSRV_CLIENTID',
    clientSecret: 'CMNSRV_CLIENTSECRET',
    apiUrl: 'CLOGS_HTTP_APIURL',
    env: 'CLOGS_METADATA_ENV'
});

class Connection {
    constructor(options) {
        if (!options || !options.tokenUrl || !options.clientId || !options.clientSecret) {
            throw new Error('Connection is not configured.  Check configuration.');
        }

        this.tokenUrl = options.tokenUrl;

        this.axios = axios.create();
        this.axios.interceptors.request.use(
            // Wraps axios-token-interceptor with oauth-specific configuration,
            // fetches the token using the desired claim method, and caches
            // until the token expires
            oauth.interceptor(tokenProvider, oauth.client(axios.create(), {
                url: this.tokenUrl,
                grant_type: 'client_credentials',
                client_id: options.clientId,
                client_secret: options.clientSecret,
                scope: ''
            }))
        );
    }
}

class LogDelivery {
    constructor() {
        this._tokenUrl = envParser.getString(Constants.tokenUrl);
        this._clientId = envParser.getString(Constants.clientId);
        this._clientSecret = envParser.getString(Constants.clientSecret);
        this._apiUrl = envParser.getString(Constants.apiUrl);
        this._env = envParser.getString(Constants.env, 'dev');

        if (stringUtils.isEmpty(this._tokenUrl) || stringUtils.isEmpty(this._clientId) || stringUtils.isEmpty(this._clientSecret) || stringUtils.isEmpty(this._apiUrl)) {
            const msgs = ['Transporter configuration error'];
            msgs.push(`tokenUrl(${Constants.tokenUrl}) = ${process.env[Constants.tokenUrl]}`);
            msgs.push(`clientId(${Constants.clientId}) = ${process.env[Constants.clientId]}`);
            msgs.push(`clientSecret(${Constants.clientSecret}) = ${process.env[Constants.clientSecret]}`);
            msgs.push(`apiUrl(${Constants.apiUrl}) = ${process.env[Constants.apiUrl]}`);
            throw new Error(msgs.join('\n'));
        }
        this._connection = new Connection({
            tokenUrl: this._tokenUrl,
            clientId: this._clientId,
            clientSecret: this._clientSecret
        });
        this._axios = this._connection.axios;
    }

    async deliver(messages) {
        if (messages) {
            const batch = Array.isArray(messages) ? messages : [messages];

            if (batch.length) {
                // remove any items that do not have a message, invalid CLOGS message
                let messages = batch.filter(l => {
                    return stringUtils.isNotEmpty(l.message);
                });
                // add additional metadata on each message
                messages.forEach(m => m = Object.assign(m, {env: this._env}));

                try {
                    const response = await this._axios.post(
                        `${this._apiUrl}/api/v1/log`,
                        messages,
                        {
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            maxContentLength: Infinity,
                            maxBodyLength: Infinity
                        }
                    );
                    if (response.status !== 201) {
                        console.log(`warn ${response.status} from Common Logging Service`);
                    } else {
                        console.log(`submitted ${batch.length} to Common Logging Service`);
                    }
                } catch (e) {
                    const errMsg = e.response ? `${e.response.status} from Common Logging Service. Data : ${JSON.stringify(e.response.data)}` : `Unknown error from Common Logging Service: ${e.message}`;
                    console.log(`error ${errMsg}`);
                }
            }
        }
    }
}

module.exports = LogDelivery;
