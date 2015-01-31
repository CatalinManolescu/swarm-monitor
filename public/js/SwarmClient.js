
/**********************************************************************************************
 * SwarmClient Class: web browser client, using websockets
 **********************************************************************************************/
var useSocketIo = true;

function SwarmClient(host, port, userId, authToken, tenantId, loginCtor, securityErrorFunction, errorFunction) {
    var self = this;
    var socket;
    var outletId = "";
    var sessionId = null;
    var loginOk = false;
    var pendingCmds = [];
    var callBacks = {};
    var apiVersion = '2.0';
    var currentFunction = waitingForIdentity;
    var connectionInProgress = false;
    var isConnected = false;
    var nrAttemptReconnect = 8;
    var currentAttemptToReconnect = 0;
    var connectionString;
    if(useSocketIo){
        connectionString ="http://"+host + ":" + port;
    }else{
        connectionString ="ws://"+host + ":" + port;
    }

    //TODO : Websockets apparently send message twice (sometimes)
    // see : https://github.com/LearnBoost/socket.io/issues/997
    var requestHandleCount = {};


    this.getOutletId = function () {
        return outletId;
    }

    this.getSessionId = function () {
        return sessionId;
    }

    createSocket();

    function createSocket() {
       
        isConnected = false;
        if(useSocketIo){
            if(socket){

                socket = io.connect(null, {transports: ['websocket', 'polling', 'flashsocket'],
                                            'force new connection':true});
            } else {
                //TODO:implement all handlers
                /*
                 'message'
                 'connect'
                 'disconnect'
                 'open'
                 'close'
                 'error'
                 'retry'
                 'reconnect'
                 */
                socket = io.connect(connectionString);
                socket.on('connect', socket_onConnect);
                socket.on('data', socket_onStreamData);
                socket.on('message', socket_onStreamData);
                socket.on('error', socket_onError);
                socket.on('disconnect', socket_onDisconnect);
                socket.on('retry', socket_onRetry);
                socket.on('reconnect', socket_onReconect);
            }
        } else {
            socket = new WebSocket(connectionString);
            socket.onmessage =   function(data){
                socket_onStreamData(JSON.parse(data.data));
            }
            socket.onerror   =  socket_onError;
            socket.onclose   =  socket_onDisconnect;
            socket.onopen   =  socket_onConnect;

            setTimeout(function(){
                console.log('swarming socket ready:', socket.readyState);
                     if(socket.readyState != 1){
                         socket.onerror();
                     }
            }, 1000);
        }

    }

    function socket_onConnect(){
        isConnected = true;
        getIdentity();
    }


    this.destroySocket = function(){
        if(useSocketIo){
            delete socket;
            delete this;
        } else {

            socket.onerror = function(){};
            socket.onclose = socket.onerror;
            socket.onopen  = socket.onerror;

            socket.close();
            delete socket;
        }

    }

    function socket_onError(err) {
        if(err){
            console.log("Socket error", err);
        }
        if(errorFunction){
            errorFunction(err);
        }else{
            console.log("socket_onError handler");
        }
        socket_onDisconnect();
    }

    var showingAlert = false;
    function socket_onDisconnect(err) {
        /*if(errorFunction){
            errorFunction(err);
        }else{

        }*/

        if(currentAttemptToReconnect < nrAttemptReconnect) {

            if (!useSocketIo) {
                try {
                    self.destroySocket();
                } catch (err) {
                    console.log("eroare IE ", err);
                }
                createSocket();
                //console.log("isConnected",currentAttemptToReconnect);
            }
        }
        setTimeout(function(){
            if(isConnected){
                //console.log("isConnected",isConnected);
                currentAttemptToReconnect = 0;
            }else{
                currentAttemptToReconnect++
                if(currentAttemptToReconnect == nrAttemptReconnect){
                    console.log('Network disconnected');
                    /*if(!showingAlert){
                        showingAlert = true;
                        shape.alert("Network connection is down. Click ok to connect!", function(){
                            showingAlert = false;
                            if(!useSocketIo){
                                try{
                                    self.destroySocket();
                                }catch(err){
                                    console.log("eroare IE ",err);
                                }
                                currentAttemptToReconnect = 0;
                                createSocket();
                            }
                        });
                    }*/
                }
            }
        }, 1000);
    }

    function socket_onRetry() {

    }

    function socket_onReconect() {
        //lprint("socket_onReconect handler");
        //getIdentity();
    }

    function socket_onStreamData(data) {
        if(data.swarmDataGotProcessed){
            
        } else {
            data.swarmDataGotProcessed = true;
            currentFunction(data);
        }
    }

    this.tryLogin = function(__userId, __authToken, __tenantId, __loginCtor, recreateConnection){

        userId     = __userId;
        authToken  = __authToken;
        tenantId   = __tenantId;
        loginCtor  = __loginCtor;

        if(!isConnected){
            return;
        }
        if(useSocketIo){
            if(recreateConnection) {
                createSocket();
            }
            getIdentity();
        } else {
            //this.destroySocket();
            createSocket();
        }

    }


    function doLogin(){
        var cmd = {
            meta: {
                swarmingName: "login.js",
                command: "start",
                ctor: loginCtor,
                tenantId: tenantId,
                commandArguments: [sessionId, userId, authToken]
            }
        };
        self.writeObject(cmd);
    }

    function waitingForIdentity(data) {
        if (data.meta && data.meta.command == "identity") {
            currentFunction = waitingForLogin;
            sessionId = data.meta.sessionId;
            apiVersion = data.meta.apiVersion;

            if (apiVersion !== "2.0") {
                console.log("Api version doesn't match !", "Api version error, 2.0 expected");
            }

            doLogin(userId, authToken, tenantId, loginCtor);
        }
    }



    function waitingForLogin(data) {
        var i;
        var command;
        var len;

        connectionInProgress = false;
        loginOk = data.authenticated;

        if (loginOk) {
            outletId = data.meta.outletId;
            sessionId = data.meta.sessionId;
            currentFunction = socket_onDataReady;
            loginOk = true;

            for (i = 0; len = pendingCmds.length, i < len; i++) {
                command = pendingCmds[i];
                command.meta.sessionId = sessionId;
                command.meta.outletId = outletId;
                self.writeObject(command);
            }

            pendingCmds = [];
            callSwarmingCallBack(data.meta.swarmingName, data);
        }
        else {
            if(securityErrorFunction){
                securityErrorFunction(data.meta.currentPhase, data);
            } else {
                console.log("Login failed !", "Login failed : authorisationToken:[" + data.authorisationToken + "] userId:[" + data.userId + "]");
            }
        }
    }

    function socket_onDataReady(data) {
        if (data && data.meta && data.meta.changeSessionId == true) {
            sessionId = data.meta.sessionId;
        }

        callSwarmingCallBack(data.meta.swarmingName, data);
    }

    function callSwarmingCallBack(swarmingName, data) {
        var callbackList = callBacks[swarmingName];
        if (callbackList !== null && callbackList instanceof  Array) {
            for (var i = 0, len = callbackList.length; i < len; i++) {
                var callback = callbackList[i];
                try {
                    shapePubSub.blockCallBacks();
                    callback(data);
                    shapePubSub.releaseCallBacks();
                }
                catch (e) {
                    console.log(e + " in swarm generated callback: " + callback ,e );
                }
            }
        }
    }

    function getIdentity() {
        console.log("Preparing for communication...");
        /* if (connectionInProgress) {
            return;
        } */
        connectionInProgress = true;
        outletId = "";
        sessionId = null;
        loginOk = false;
        pendingCmds = [];
        currentFunction = waitingForIdentity;
        var cmd = {
                meta: {
                    swarmingName: 'login.js',
                    command: 'getIdentity',
                    ctor: 'authenticate'
                }
            };
        self.writeObject(cmd);
    }

    var requestCounter = 0;
    function createRequestIdentity(){
        requestCounter++;
        return outletId + "/" + requestCounter;
    }

    this.startSwarm = function (swarmName, ctorName) {
        var args = Array.prototype.slice.call(arguments,2);
        //console.log('Start swarm: ' + swarmName);
        for(var i=0;i<args.length; i++ ){
            if(objectIsShapeSerializable(args[i])){
                args[i] = args[i].getInnerValues();
            }
        }
        var cmd = {
            meta: {
                sessionId: sessionId,
                processIdentity:createRequestIdentity(),
                swarmingName: swarmName,
                tenantId: tenantId,
                outletId: outletId,
                command: "start",
                ctor: ctorName,
                commandArguments: args
            }
        };

        if (loginOk == true) {
            self.writeObject(cmd);
        }
        else {
            pendingCmds.push(cmd);
        }
        return cmd;
    }

    this.on = function (swarmingName, callback) {
        if (!callBacks[swarmingName]) {
            callBacks[swarmingName] = [];
        }
        this.off(swarmingName, callback);
        callBacks[swarmingName].push(callback);
    }

    this.off = function (swarmingName, callback) {
        var callbackList = callBacks[swarmingName];
        if (callbackList !== null) {
            for (var i = 0, len = callbackList.length; i < len; i++) {
                var c = callbackList[i];
                if (callback === c) {
                    callbackList.splice(i, 1);
                    return;
                }
            }
        }
    }

    this.writeObject = function (value) {

        if(useSocketIo ){
            if (socket) {
                //console.log("Emiting: ", value);
                socket.emit('message', value);
            }
        } else {
            socket.send(J(value));
        }
    }
}


function cprint(){
    var output = "";
    for(var i=0;i<arguments.length;i++ ){
        var arg = arguments[i];
        if(typeof arg  != "object"){
            output+= arg;
        } else {
            output+= JSON.stringify(arg);
        }
        output+= " ";
    }
    console.log("lprint#", output);
}

function dprint(){
    var output = "";
    for(var i=0;i<arguments.length;i++ ){
        var arg = arguments[i];
        if(typeof arg  != "object"){
            output+= arg;
        } else {
            output+= JSON.stringify(arg);
        }
        output+= " ";
    }
    console.log("lprint#", output);
}

function lprint(){
    var output = "";
    for(var i=0;i<arguments.length;i++ ){
        var arg = arguments[i];
        if(typeof arg  != "object"){
            output+= arg;
        } else {
            output+= JSON.stringify(arg);
        }
        output+= " ";
    }
    console.log("lprint#", output);
}

function wprint (){
    var output = "";
    for(var i=0;i<arguments.length;i++ ){
        var arg = arguments[i];
        if(typeof arg  != "object"){
            output+= arg;
        } else {
            output+= JSON.stringify(arg);
        }
        output+= " ";
    }
    console.log("lprint#", output);
}

function esprint(str, err){
    console.log(str,err);
}

function eprint(str, err){
    console.log(str,err);
}


function hookConsoleOnMobile(){

}
