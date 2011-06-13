#!/usr/bin/env node
/*
 * node maptracker.js <file_to_tail> [hostname] [port]
 */

var http = require('http')
  , spawn = require('child_process').spawn

  , express = require('express')
  , io = require('socket.io')

  , geoip = require('geoip')
  , City = geoip.City
  , cities = new City(__dirname + '/GeoLiteCity.dat')

  , port = process.argv.length >= 3 && process.argv[3] || process.env.PORT || process.env.POLLA_PORT || 8080
  , host = process.argv.length >= 2 && process.argv[2] || process.env.HOST || process.env.POLLA_HOST || 'localhost'

  , wsport = process.env.WSPORT || + port + 111
  , wshost = process.env.WSHOST || host

  , fs = require('fs')
  , pixel = fs.readFileSync(__dirname + '/pixel.gif')
  , pixelHeaders = {
    'Cache-Control': 'private, no-cache, proxy-revalidate',
    'Content-Type': 'image/gif',
    'Content-Disposition': 'inline',
    'Content-Length': pixel.length
  }

// configuration
var app = express.createServer()

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.logger());
  app.use(express.methodOverride());
  app.use(express.bodyParser());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());
});

// main app

var allowedIPs = {}
  , connected = {}
  , users = {}

app.get('/', function(req, res) {
  res.redirect('/map');
})

app.get('/map', function(req, res) {
  res.render('map', { layout: false, locals: { title: 'maptrack', wshost: wshost, wsport: wsport } })
})

app.get('/pixel.gif', function(req, res) {
  res.writeHead(200, pixelHeaders);
  res.end(pixel);
  remote_ip = req.headers['x-real-ip'] // We're forwarding trough NginX
  site_name = 'http://matsimitsu.com'
  cities.lookup(remote_ip, function(err, data) {
      if (err) {
        console.log('Could not grab location for', remote_ip, ' - ', data)
      }
      if (data) {
        result = { name: site_name, line: remote_ip, lastActivity: Date.now() }
        result.city = data
        result.lat = data.latitude
        result.lng = data.longitude

        world.messageCount++
        world.users[remote_ip] = result

        world.sendUpdate(result)
      }
  });
})


// get configuration information
app.get('/js/config.js', function(req, res) {
  html = [
  'var WSHOST = "' + wshost + '";'
  + 'var WSPORT = ' + wsport + ';'
  ]

  res.send(html.join('\n'))
})

app.get('/admin', function(req, res) {
  req.users.list(function(err, data) {
    res.render('admin', { locals: { title: 'Admin area', data: data } })
  })
})

// start Server
app.listen(port, host);

// socket.io

var wsserver = http.createServer()
wsserver.listen(wsport, wshost);
var socket = io.listen(wsserver)

socket.on('connection', function(client) {
  var id = client.sessionId
    , ip = client && client.request && client.request.socket && client.request.socket.remoteAddress || '000'

  connected[id] = client

  world.sendStartupData(client)

  client.on('disconnect', function() {
    delete connected[id]
  })
})

var world = {
  users: {}
, messages: []
, messageCount: 0
, getPublicUserInfo: function(user) {
    return {
      'name': user.name
    , 'city': user.city
    , 'lng': user.lng
    , 'lat': user.lat
    , 'lastActivity': user.lastActivity
    }
  }

, sendUpdate: function(from, silent) {
    var self = this

    self.messages.push({
      'user': from.name
    , 'city': from.city
    , 'message': from.line
    })

    if (self.messages.length > 10) {
      self.messages.shift()
    }

    if (from && from.lat) {
      var returnObj = {
        'action': 'newMessage'
      , 'from': self.getPublicUserInfo(from)
      , 'messageCount': self.messageCount
      }

      if (!silent) {
        if (self.messages.length) {
          returnObj.messages = [self.messages[self.messages.length - 1]]
        }
        else {
          returnObj.messages = []
        }
      }

      broadcast(returnObj)
    }
    else {
      console.log('Failed update, ' + from.name + ' lacks coordinates.')
    }
  }

, sendStartupData: function (client) {
    var self = this

    var activityLimit = new Date().getTime() - 2400000
    var userList = {}

    Object.keys(self.users).forEach(function (name) {
      var user = self.users[name]
      if (user.lat && user.lastActivity > activityLimit) {
        userList[name] = self.getPublicUserInfo(user)
      } else {
        delete self.users[name]
      }
    })

    client.send(JSON.stringify({
      'action': 'getUsers'
    , 'users': userList
    , 'removeTimeout': 2400000
    , 'channel': 'main'
    , 'messages': self.messages
    , 'messageCount': self.messageCount
    , 'serverTime': new Date().getTime()
    }))
  }
}


// functions

var broadcast = function(msg) {
  var json = JSON.stringify(msg)

  for (var id in connected) {
    connected[id].send(json)
  }
}
