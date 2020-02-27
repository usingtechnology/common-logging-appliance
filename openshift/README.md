## preamble

The following instructions are for running the provided [BuildConfig](./app.bc.yaml) and [DeploymentConfig](./app.dc.yaml) to stand up an appliance that will pull pod logs and deliver them to Common Logging Service (see [Common Services Showcase](https://bcgov.github.io/common-service-showcase/) for more information about onboarding).  

The instructions are for a user/developer that has ADMIN privileges to the Openshift Project/Namespace.  These instruction examples are for a *nix based system, adapt as needed for your system and your namespace.  

**IMPORTANT**  
Track the name of the objects you create, you will need them later to specify in the DeploymentConfig.  We will use the defaults here.  

### login to oc as namespace admin

1. [Openshift Console](https://console.pathfinder.gov.bc.ca:8443/console/) and log in  
2. Select your username (top right corner)   
3. Click the Copy Login Command menu item  
4. Open a terminal session (instructions are assuming *nix)  
5. Paste the Login Command  
6. (Optional) Set environment variables for your commands  
7. Go to your project (namespace)  

```sh
oc login https://console.pathfinder.gov.bc.ca:8443 --token=x0Kpa6x1K1oujvyhf1Ja81Bl8KNdai6NzmJob98wMfx
```
#### set environment variables
##### namespace - should be used on all oc commands
```
export NAMESPACE=idcqvl-dev
```
##### Openshift resources we will create and use in DeploymentConfig
```
export OPENSHIFT_CLI_CONFIG=logapp-openshift-cli-config
export LOG_DELIVERY_CONFIG=logapp-log-delivery-config
export LOG_DELIVERY_SECRET=logapp-common-service-secret
export LOG_DELIVERY_CLIENTID=CMNSRV_CLIENTID
export LOG_DELIVERY_CLIENTSECRET=CMNSRV_CLIENTSECRET
```
#### go to namespace
```
oc project $NAMESPACE
```


### create secrets

#### log delivery library

Create a Secret for the Log Delivery library.  This is a service client that has been created and granted access to Common Logging Service.  The token url will be specified in a ConfigMap.  

```sh
oc create -n $NAMESPACE secret generic $LOG_DELIVERY_SECRET \
  --type=kubernetes.io/basic-auth \
  --from-literal=username=<common service client id> \
  --from-literal=password=<common service client password>
```  


### create config maps

#### openshift cli library

Create a ConfigMap for the Openshift Client library.  This is what will find pods and continually query their logs.  

Specify Pod Name & Container Name to target a single, specific pod - or - specify a Selector (ex. role=app) to select many Pods.  If all 3 variables are set, the Pod Name/Container Name will be used, not the Selector.  

| Name | Required | Description |
| --- | --- | --- |
| LOGAPP\_NAMESPACE | yes | Namespace appliance will be running |
| LOGAPP\_POLL\_INTERVAL | no | Value in milliseconds for polling.  Defaults to 30000 (30s) |
| LOGAPP\_POD\_NAME | conditional | Name of a Pod, used with Container Name|
| LOGAPP\_CONTAINER\_NAME | conditional | Name of Container, used with Pod Name |
| LOGAPP\_SELECTOR | conditional | an Openshift selector to get many pods (ex. role=app) |
| LOGAPP\_LIMIT\_BYTES | no | Value in bytes to limit the amount of data returned from the log query.  This is important to keep relatively low (~100000) as it will affect the size of batches sent downstream.  Defaults to 50000 |
| LOGAPP\_SINCE\_TIME | no | Specify the start date for pulling logs.  RFC3339 date (ex. 2020-01-01T13:55:10.464277274Z). Defaults to 15 minutes prior to appliance stand up. |

```sh
oc create -n $NAMESPACE configmap $OPENSHIFT_CLI_CONFIG \
  --from-literal=LOGAPP_NAMESPACE=$NAMESPACE \
  --from-literal=LOGAPP_POLL_INTERVAL=30000 \
  --from-literal=LOGAPP_POD_NAME= \
  --from-literal=LOGAPP_CONTAINER_NAME= \
  --from-literal=LOGAPP_SELECTOR=role=app \
  --from-literal=LOGAPP_LIMIT_BYTES=100000 \
  --from-literal=LOGAPP_SINCE_TIME=2020-02-02T00:00:00Z

```

#### log delivery library

Create a ConfigMap for the Log Delivery library.  This is what transfers the log file data to Common Logging Service. 


| Name | Required | Description |
| --- | --- | --- |
| CLOGS\_HTTP\_APIURL | yes | Base url for Common Logging Service |
| CLOGS\_METADATA\_ENV | no | Environment metadata, used to tell Common Logging the environment (and ELK stack index) |
| CMNSRV\_TOKENURL | yes | OAuth token url for Log Delivery Client authorization |

```sh
oc create -n $NAMESPACE configmap $LOG_DELIVERY_CONFIG \
  --from-literal=CLOGS_HTTP_APIURL=https://clogs-dev.pathfinder.gov.bc.ca \
  --from-literal=CMNSRV_TOKENURL=https://sso-dev.pathfinder.gov.bc.ca/auth/realms/jbd6rnxw/protocol/openid-connect/token \
  --from-literal=CLOGS_METADATA_ENV=dev 

```

### run build config

Now that the Secret and ConfigMaps are created, we can run the BuildConfig.  The following assumes you are in the same terminal session and are running the local build config file.  Make sure your local file matches the Github Source Repo Ref you intend.  

| Name | Required | Description |
| --- | --- | --- |
| REPO\_NAME | yes | Application repository name |
| JOB\_NAME | yes | Job identifier (i.e. 'pr-5' OR 'master') |
| SOURCE\_REPO\_REF | yes | Git Pull Request Reference (i.e. 'pull/CHANGE_ID/head') |
| SOURCE\_REPO\_URL | yes | Git Repository URL |

```sh
export REPO_OWNER=parc-jason
export REPO_NAME=common-logging-appliance
export JOB_NAME=master
export SOURCE_REPO_REF=master
export SOURCE_REPO_URL=https://github.com/$REPO_OWNER/$REPO_NAME.git


oc -n $NAMESPACE process -f openshift/app.bc.yaml -p REPO_NAME=$REPO_NAME -p JOB_NAME=$JOB_NAME -p SOURCE_REPO_URL=$SOURCE_REPO_URL -p SOURCE_REPO_REF=$SOURCE_REPO_REF -o yaml | oc -n $NAMESPACE apply -f -
 
oc -n $NAMESPACE start-build $REPO_NAME-logapp-$JOB_NAME --follow 

# if build fails due to network policies in your namespace, run the following nsp template and re-start the build
oc -n $NAMESPACE process -f openshift/build.nsp.yaml -p REPO_NAME=$REPO_NAME -p JOB_NAME=$JOB_NAME -p NAMESPACE=$NAMESPACE -o yaml | oc -n $NAMESPACE apply -f -

# do this tagging if running manually, this should be taken care of in a build pipeline
oc -n $NAMESPACE tag $REPO_NAME-logapp:latest $REPO_NAME-logapp:$JOB_NAME

```


### run deployment config

| Name | Required | Description |
| --- | --- | --- |
| REPO\_NAME | yes | Application repository name |
| JOB\_NAME | yes | Job identifier (i.e. 'pr-5' OR 'master') |
| NAMESPACE | yes | which namespace/"environment" are we deploying to? dev, test, prod? |
| APP\_NAME | yes | short name for the application |
| OPENSHIFT\_CLI\_CONFIG | no | Name of Openshift ConfigMap for Openshift Cli config. Default logapp-openshift-cli-config |
| LOG\_DELIVERY\_CONFIG | no | Name of Openshift ConfigMap for Log Delivery logapp-log-delivery-config |
| LOG\_DELIVERY\_SECRET | no | Name of Openshift Secret for Log Delivery logapp-common-service-secret |
| LOG\_DELIVERY\_CLIENTID | no | Name of environment varible to set for username from Log Delivery Secret. Default CMNSRV\_CLIENTID |
| LOG\_DELIVERY\_CLIENTSECRET | no | Name of environment varible to set for password from Log Delivery Secret. Default CMNSRV\_CLIENTSECRET |


```sh
export APP_NAME=cdogs

oc -n $NAMESPACE process -f openshift/app.dc.yaml -p REPO_NAME=$REPO_NAME -p JOB_NAME=$JOB_NAME -p NAMESPACE=$NAMESPACE -p APP_NAME=$APP_NAME -o yaml | oc -n $NAMESPACE apply -f -

# triggers should start this deployment, but this is the command just in case.
oc -n $NAMESPACE rollout latest dc/$APP_NAME-logapp-$JOB_NAME
```


### cleanup


```sh

oc -n $NAMESPACE delete all --selector template=$REPO_NAME-logapp-bc-template,template=$REPO_NAME-logapp-dc-template

# if you applied the NSP
oc -n $NAMESPACE delete nsp --selector template=$REPO_NAME-logapp-nsp-template

# secrets and config maps
oc -n $NAMESPACE delete secret $LOG_DELIVERY_SECRET
oc -n $NAMESPACE delete cm $LOG_DELIVERY_CONFIG
oc -n $NAMESPACE delete cm $OPENSHIFT_CLI_CONFIG

```
