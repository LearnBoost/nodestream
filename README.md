Nodestream
==========

Nodestream aims to make the most common use cases for realtime web applications easy to implement, by connecting event listeners to template rendering.

## Example

### Use-case

Consider the following example, written in Express. The following two routes show and save items respectively

	app.get('/', function(req, res){
		database.getItems(function(items){
			res.render('my.items.jade', {locals: { items: items }})
		})
	})
	
	app.post('/save/item', function(req, res){
		database.saveItem(req.body, function(){
			res.redirect('/');
		})
	})

And the following template displays them

	- each item in items
		div.item
			p This is an item titled #{item.title}

When a user loads the page, he'll see all the items that are in the database at that particular moment. When he adds one, he'll be redirected and the page will be refreshed entirely.

### The need for realtime

Even though this model works fine for really simple applications, reloading the page after a save is often undesirable. Developers usually turn to ajax, which means after a save a chunk of html is taken and appended it to the list.

This approach has drawbacks:

- If a user has multiple tabs open with your applicaiton, only one tab will be updated.

- If multiple users are editing concurrently, only your own changes are shown, but not changes from others.

### The nodestream solution

Building on top of the powerful jade template engine filters, nodestream solves the problems listed above by making only two changes to your applications:

1. Firing events

	database.saveItem(item){
		...
		nodestream.emit('newitem', item)
	}
	
2. Adding a line of code to your template (`:realtime`)

	:realtime(append: 'newitem', local: 'items', obj: 'item')
		div.item
			p This is an item titled #{item.title}
			
### How to use

1. Include [`socket.io`](http://github.com/learnboost/socket.io-node) and `nodestream`:

	var io = require('socket.io');
	require('nodestream');
	
2. Attach `socket.io` to your `http.Server` and load nodestream

	var nodestream = io.listen(httpserver).nodestream();

3. In the client side, load `public/nodestream.js` and attach it to your `io.Socket`

	var mySocket = new io.Socket():
	mySocket.connect();
	Nodestream(mySocket);
	
4. In your code, fire events and edit your templates!

### API

The `:realtime` filter takes the following options

`local`: The local variable passed to your template that your piece of html interacts with
`obj`: Required for `append`, the name of the local used when the collection is looped through.
`append`: Append event
`repaint`: Repaint event name. If it finished on `.`, the `id` property is appended to it for every item on a collection (dynamic event name)
`remove`: Remove event name. If it finished on `.`, the `id` property is appended to it for every item on a collection (dynamic event name)
`id`: The name of the key to look for an unique identifier to append to events finished in `.`

### Example

#### Showing how many users are browsing your website

On the server side:
	
	var connections = 0;
	var nodestream = io.listen(app).nodestream()
	  .on('connect', function(){
	    connections++;
	    this.emit('connections', connections);
	  })
	  .on('disconnect', function(){
	    connections--;
	    this.emit('connections', connections);
	  });

On the client side:

	:realtime(repaint: 'connections', local: 'connections')
	  .connections
	    - if (connections > 1)
	      p #{connections} people are editing right now
	    - else
	      p You're all alone, loser