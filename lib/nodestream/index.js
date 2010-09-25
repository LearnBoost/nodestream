// pending subscriptions maps a hash of the session id, filename and block id
// to 
var pendingSubscriptions = {},
    subscriptions = {},
    fileBlocks = {};

var sys = require('sys');

// socket.io additions

function subscribe(client, nodeid, ev, type, file, blockIndex, local, sessionId){
  if (!(ev in subscriptions)) subscriptions[ev] = [];
  if (!(ev in client._nodestreamCleanup)) client._nodestreamCleanup[ev] = [];
  client._nodestreamCleanup[ev].push(subscriptions.length);
  subscriptions[ev].push({
    nodeId: nodeid
  , type: type
  , clientId: client.sessionId
  , file: file
  , blockIndex: blockIndex
  , local: local
  , sessionId: sessionId
  });
};

function paint(type, filename, index, local, obj, sessionId){
  var locals = {};
  locals[local] = obj;
  locals._ = {};
  locals.attrs = attrs;
  locals.escape = escape
  // fake a request
  var req = new Request();
  req.sessionId = sessionId;
  var oldSubscribe = req.subscribe;
  // do not resubscribe to append
  req.subscribe = function(file, blockIndex, append, repaint, remove, local){
    return oldSubscribe.call(req, file, blockIndex, '', repaint, remove, local);
  };
  return fileBlocks[filename][index][type].call(req, locals);
};

var Listener = require('socket.io').Listener;

Listener.prototype.nodestream = function(){
  if (!this._nodestream){
    // prevent double-attachment
    this._nodestream = new Nodestream(this);
  }
  return this._nodestream;
};

var Nodestream = function(socket){
  this.socket = socket;
  var self = this;
  socket.on('connection', function(c){
    c.on('message', function(msg){
      if (typeof msg == 'object' && 'nodestream' in msg){
        self._handle(c, msg);
        if (!c._nodestream){
          self._emit('connect', c);
          c._nodestream = true;
        }
      }
    });
    c.on('disconnect', function(){
      if (c._nodestream){
        self._end(c);
      }
    });
  });
};

sys.inherits(Nodestream, process.EventEmitter);

Nodestream.prototype._emit = Nodestream.prototype.emit;

Nodestream.prototype._handle = function(client, message){
  if (!('_nodestreamCleanup' in client)) client._nodestreamCleanup = {};
  // we receive a hash that confirms the suscription of the client
  // to the events stored by that hash
  if (message.subscribe){
    // lookup pending subscriptions by hash
    var subscription = pendingSubscriptions[message.subscribe];
    
    if (subscription){
      if (subscription[2] && subscription[2].length > 1)
        subscribe(client, message.subscribe, subscription[2], 'append', subscription[0], subscription[1], subscription[5], subscription[6]);
      if (subscription[3] && subscription[3].length > 1)
        subscribe(client, message.subscribe, subscription[3], 'repaint', subscription[0], subscription[1], subscription[5], subscription[6]);
      if (subscription[4] && subscription[4].length > 1)
        subscribe(client, message.subscribe, subscription[4], 'remove', subscription[0], subscription[1], null, subscription[6]);

      delete pendingSubscriptions[message.subscribe];
    } else {
      console.error('cant find subscription by encoded id ' + message.subscribe);
    }
  }
};

Nodestream.prototype._end = function(client){
  for (var ev in client._nodestreamCleanup){
    (function(ev){
      client._nodestreamCleanup[ev].forEach(function(i){
        subscriptions[ev][i] = null;
      });
    })(ev);
  }
  this._emit('disconnect', client);
};

Nodestream.prototype.emit = function(ev, obj){
  // notify suscriptors
  var socket = this.socket;
  if (ev in subscriptions){
    subscriptions[ev].forEach(function(s){
      if (!s) return;
      if (socket.clients[s.clientId]){
        var args = {id: s.nodeId};
        
        if (s.type == 'repaint' || s.type == 'append'){
          args.html = paint(s.type, s.file, s.blockIndex, s.local, obj, s.sessionId);
        }
        
        socket.clients[s.clientId].send({
          nodestream: 1,
          type: s.type,
          args: args
        })
      }
    });
  }
};

// express request

var crypto = require('crypto')
  , Request = require('http').IncomingMessage;

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

Request.prototype.subscribe = function(file, blockIndex, append, repaint, remove, local){
  if (!('_pendingSubscriptions' in this)){
    this._pendingSubscriptions = {};
  }
  
  var hash = md5(file + blockIndex + this.sessionId + append + repaint + remove)
    , random = md5(hash + Math.random());
  
  if (hash in this._pendingSubscriptions){
    return this._pendingSubscriptions[hash];
  }
  
  pendingSubscriptions[random] = Array.prototype.slice.call(arguments).concat(this.sessionId);
  this._pendingSubscriptions[hash] = random;
  return random;
};

// filters
var jade = require('jade')
  , Compiler = jade.Compiler
  , filters = jade.filters
  , nodes = jade.nodes;

filters.realtime = function(block, compiler, attrs){
    var placeholder, filename = compiler.options.filename;
  
  if (!(filename in fileBlocks)) fileBlocks[filename] = [];
  
  block.forEach(function(node, i){
    if (node.name == 'placeholder'){
      placeholder = new nodes.Tag('div', node.block);
      placeholder.setAttribute('class', '"placeholder"')
      block.splice(i, 1);
    }
  });
  
  if (!attrs.local){
    throw new Error('Please pass the `local` to the :realtime filter options');
  }
  
  if (!attrs.append && !attrs.obj){
    attrs.obj = attrs.local;
  }
  
  var events = ['undefined', attrs.repaint || 'undefined', attrs.remove || 'undefined'];
  
  events.forEach(function(name, i){
    // append '+ obj.id' to events finishing in a dot
    if (/\.'$/.test(name)){
      events[i] = name + (' + ' + (eval(attrs.obj) || 'obj') + '.' + (eval(attrs.id) || 'id'));
    } 
  });
  
  // wrapper tag
  // actually: there's no need to wrap! we could inspect the `class` of the main node, or we could make it an option
  var subscribeString = 'this.subscribe("'+ filename +'", '+ fileBlocks[filename].length + ', ' + events.join(',') + ', '+ (attrs.obj || '"obj"') +')';
  
  block[0].setAttribute('class', block[0].getAttribute('class') + ' + "nodestream nodestream_" + ' + subscribeString);
  block.push(new nodes.Filter('javascript', new nodes.Text('Nodestream.register(\'#{'+ subscribeString +'}\');')));
  
  var compiled = {};
  
  if (attrs.append){
    var bl = new nodes.Block()
      , ifNode = new nodes.Code('if ('+ eval(attrs.local) +'.length)')
      , forEachBlock = new nodes.Block()
      , forEach = new nodes.Each(eval(attrs.local), eval(attrs.obj) || 'obj', undefined, block)
      , elseNode = new nodes.Code('else')
      , elseBlock = new nodes.Block();
        
    forEachBlock.push(forEach);
    ifNode.block = forEachBlock;
    
    if (placeholder){
      elseBlock.push(placeholder);
      elseNode.block = elseBlock;
    }
    
    bl.push(ifNode);
    bl.push(elseNode);
    
    var cc = new Compiler(block);
    compiled['append'] = new Function('locals', 'with (locals) {' + cc.compile() + '}');
    
    // create a fake invisible element that serves as an indicator of where the parent container is
    events = [attrs.append, 'undefined', 'undefined'];
    subscribeString = 'this.subscribe("'+ filename +'", '+ fileBlocks[filename].length + ', ' + events.join(',') + ', '+ (attrs.obj || '"obj"') +')';
    var appendPlaceholder = new nodes.Tag('div');
    appendPlaceholder.setAttribute('class', '"nodestream nodestream_" + ' + subscribeString);
    bl.push(appendPlaceholder);
    bl.push(new nodes.Filter('javascript', new nodes.Text('Nodestream.register(\'#{'+ subscribeString +'}\');')));
  }
  
  if (attrs.repaint){
    var cc = new Compiler(block[0].block);
    compiled['repaint'] = new Function('locals', 'with (locals) {' + cc.compile() + '}');
  }
  
  fileBlocks[filename].push(compiled);
  
  if (attrs.append){
    compiler.visit(bl);
  } else {
    compiler.visit(block);
  }
};

function attrs(obj){
    var buf = [],
        terse = obj.terse;
    delete obj.terse;
    var keys = Object.keys(obj),
        len = keys.length;
    if (len) {
        buf.push('');
        for (var i = 0; i < len; ++i) {
            var key = keys[i],
                val = obj[key];
            if (typeof val === 'boolean' || val === '' || val == null) {
                if (val) {
                    terse
                        ? buf.push(key)
                        : buf.push(key + '="' + key + '"');
                }
            } else {
                buf.push(key + '="' + escape(val) + '"');
            }
        }
    }
    return buf.join(' ');
}

/**
 * Escape the given string of `html`.
 *
 * @param {String} html
 * @return {String}
 * @api private
 */

function escape(html){
    return String(html)
        .replace(/&(?!\w+;)/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}