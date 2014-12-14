describe('SyncedDB', function() {
  var stores = [
    ['animals',
      ['byColor', 'color'],
      ['byName', 'name', {unique: true}],
    ],
    ['roads',
      ['byLength', 'length'],
    ],
    ['houses',
      ['keyPath', 'street'],
    ]
  ];
  afterEach(function(done) {
    var req = indexedDB.deleteDatabase('mydb');
    req.onblocked = function () { console.log('Delete was blocked'); };
    req.onsuccess = function() { done(); };
  });
  describe('Opening a database', function() {
    it('return promise resolved with db and event', function(done) {
      syncedDB.open('mydb', 1, []).then(function(res) {
        assert(res.db.db instanceof IDBDatabase);
        assert(res.e.type === 'success');
        done();
      });
    });
    it('creates database with specified version', function(done) {
      var spy = sinon.spy();
      syncedDB.open('mydb', 1, []).then(function() {
        var req = indexedDB.open('mydb', 1);
        req.onupgradeneeded = spy;
        req.onsuccess = function() {
          var db = req.result;
          assert(spy.notCalled);
          db.close();
          done();
        };
      });
    });
    it('creates object stores', function(done) {
      syncedDB.open('mydb', 1, stores).then(function() {
        var req = indexedDB.open('mydb', 1);
        req.onsuccess = function() {
          var db = req.result;
          var stores = db.objectStoreNames;
          assert(stores.length === 3);
          assert(stores.contains('animals'));
          assert(stores.contains('roads'));
          assert(stores.contains('houses'));
          db.close();
          done();
        };
      });
    });
    it('handles object store parameters', function(done) {
      syncedDB.open('mydb', 1, stores).then(function() {
        var req = indexedDB.open('mydb', 1);
        req.onsuccess = function() {
          var db = req.result;
          var tx = db.transaction(['animals', 'houses', 'roads']);
          var animals = tx.objectStore('animals');
          var roads = tx.objectStore('roads');
          var houses = tx.objectStore('houses');
          assert.equal(animals.keyPath, 'key');
          assert.equal(animals.autoIncrement, false);
          assert(roads.keyPath === 'key');
          assert(roads.autoIncrement === false);
          assert(houses.keyPath === 'key');
          assert(houses.autoIncrement === false);
          db.close();
          done();
        };
      });
    });
    it('creates indexes ', function(done) {
      syncedDB.open('mydb', 1, stores).then(function() {
        var req = indexedDB.open('mydb', 1);
        req.onsuccess = function() {
          var db = req.result;
          var tx = db.transaction(['animals', 'roads']);

          var animals = tx.objectStore('animals');
          var byColor = animals.index('byColor');
          var byName = animals.index('byName');
          var roads = tx.objectStore('roads');
          var byLength = roads.index('byLength');

          assert(byColor.keyPath === 'color');
          assert(!byColor.unique);
          assert(byName.keyPath === 'name');
          assert(byName.unique);
          assert(byLength.keyPath === 'length');
          assert(!byLength.unique);

          db.close();
          done();
        };
      });
    });
    it('handles migrations with added stores', function(done) {
      syncedDB.open('mydb', 1, stores)
      .then(function() {
        var stores2 = stores.concat([['books', ['byAuthor', 'author']]]);
        return syncedDB.open('mydb', 2, stores2);
      }).then(function() {
        done();
      });
    });
    it('handles migrations with added indexes', function(done) {
      var stores2 = [
        ['animals',
          ['byColor', 'color'],
          ['byName', 'name'],
          ['bySpecies', 'species'], // New
        ],
        ['roads',
          ['byLength', 'length'],
          ['byCost', 'cost'], // New
        ],
        ['houses',
          ['keyPath', 'street'],
        ]
      ];
      syncedDB.open('mydb', 1, stores)
      .then(function() {
        return syncedDB.open('mydb', 2, stores2);
      }).then(function() {
        done();
      });
    });
    it('calls migration hooks with db and e', function(done) {
      var m1 = sinon.spy();
      var m2 = sinon.spy();
      var m3 = sinon.spy();
      var migrations = {
        1: m1,
        2: m2,
        3: m3,
      };
      syncedDB.open('mydb', 1, stores, migrations).then(function() {
        assert(m1.firstCall.args[0] instanceof IDBDatabase);
        assert(m1.firstCall.args[1].type === 'upgradeneeded');
        assert(m2.notCalled);
        assert(m3.notCalled);
        return syncedDB.open('mydb', 3, stores, migrations);
      }).then(function() {
        assert(m2.calledOnce);
        assert(m3.calledOnce);
        assert(m3.firstCall.args[0] instanceof IDBDatabase);
        assert(m3.firstCall.args[1].type === 'upgradeneeded');
        done();
      });
    });
  });
  describe('Database', function() {
    it('is exposes stores', function(done) {
      var db = syncedDB.open('mydb', 1, stores);
      db.then(function(db) {
        done();
      });
      assert(typeof db.animals === 'object');
      assert(typeof db.stores.animals === 'object');
      assert(typeof db.animals.byColor === 'object');
      assert(typeof db.animals.byName === 'object');
      assert(typeof db.stores.roads === 'object');
      assert(typeof db.roads.byLength === 'object');
      assert(typeof db.stores.houses === 'object');
    });
  });
  describe('Transaction', function() {
    var db;
    beforeEach(function() {
      db = syncedDB.open('mydb', 1, stores);
    });
    it('gives requested stores', function(done) {
      db.read('roads', 'houses', function(stores) {
        assert(stores.roads);
        assert(stores.houses);
      }).then(function() {
        done();
      });
    });
    it('can put and get', function(done) {
      var roadKey, houseKey;
      db.read('roads', 'houses', function(stores) {
        stores.roads.put({length: 100, price: 1337})
        .then(function(key) { roadKey = key; });
        stores.houses.put({street: 'Somewhere', built: 1891})
        .then(function(key) { houseKey = key; });
      }).then(function() {
        return db.houses.get(houseKey);
      }).then(function(somewhere) {
        assert.equal(somewhere.built, 1891);
        return db.roads.get(roadKey);
      }).then(function(road) {
        assert(road.length === 100);
        done();
      });
    });
    it('can put several records at once', function(done) {
      var keys;
      db.read('roads', function(stores) {
        stores.roads.put({length: 100, price: 1337},
                         {length: 200, price: 2030})
        .then(function(putKeys) { keys = putKeys; });
      }).then(function() {
        return db.roads.get(keys[0]);
      }).then(function(road1) {
        assert(road1.length === 100);
        return db.roads.get(keys[1]);
      }).then(function(road2) {
        assert(road2.length === 200);
        done();
      });
    });
    it('can get several records at once', function(done) {
      db.read('roads', function(stores) {
        stores.roads.put({length: 100, price: 1337},
                         {length: 200, price: 2030})
        .then(function(keys) {
          console.log(keys);
          db.roads.get(keys[0], keys[1])
          .then(function(roads) {
            console.log('roads');
            console.log(roads);
            assert(roads[0].length === 100);
            assert(roads[1].length === 200);
          });
        });
      }).then(function() {
        done();
      });
    });
    it('passes id when putting', function(done) {
      var called = false;
      db.read('roads', function(stores) {
        stores.roads.put({length: 100, price: 1337, key: 1})
        .then(function(id) {
          assert(id == 1);
          called = true;
        });
      }).then(function() {
        assert(called);
        done();
      });
    });
    it('is possible to put and then get', function(done) {
      db.transaction('roads', 'rw', function(stores) {
        stores.roads.put({length: 100, price: 1337, key: 1})
        .then(function(roadKey) {
          stores.roads.get(1)
          .then(function(road) {
            assert(road.price === 1337);
            done();
          });
        });
      });
    });
    it('is possible to get and then put', function(done) {
      db.roads.put({length: 100, price: 1337, key: 1})
      .then(function() {
        db.transaction('roads', 'rw', function(stores) {
          var road = {};
          stores.roads.get(1)
          .then(function(r) {
            r.length = 110;
            r.key = 1;
            stores.roads.put(r);
          });
        }).then(function() {
          return db.roads.get(1);
        }).then(function(road) {
          console.log(road);
          assert(road.length === 110);
          done();
        });
      });
    });
  });
  describe('Store', function() {
    var db;
    beforeEach(function() {
      db = syncedDB.open('mydb', 1, stores);
    });
    it('can get records by key', function(done) {
      var IDBDb;
      db.then(function(db) {
        var req = indexedDB.open('mydb', 1);
        req.onsuccess = function() {
          IDBDb = req.result;
          var tx = IDBDb.transaction('roads', 'readwrite');
          var roads = tx.objectStore('roads');
          roads.add({length: 10, key: 'road1'});
          tx.oncomplete = postAdd;
        };
      });
      function postAdd() {
        db.roads.get('road1').then(function(road1) {
          assert(road1.length === 10);
          IDBDb.close();
          done();
        });
      }
    });
    it('can get several records by key', function(done) {
      var IDBDb;
      db.then(function(db) {
        var req = indexedDB.open('mydb', 1);
        req.onsuccess = function() {
          IDBDb = req.result;
          var tx = IDBDb.transaction('roads', 'readwrite');
          var roads = tx.objectStore('roads');
          roads.add({length: 10, key: 'road1'});
          roads.add({length: 20, key: 'road2'});
          tx.oncomplete = postAdd;
        };
      });
      function postAdd() {
        db.roads.get('road1', 'road2').then(function(roads) {
          console.log(roads);
          assert(roads[0].length === 10);
          assert(roads[1].length === 20);
          IDBDb.close();
          done();
        });
      }
    });
    it('can put records with key', function(done) {
      db.houses.put({street: 'Somewhere 8', built: 1993})
      .then(function(key) {
        return db.houses.get(key);
      }).then(function(house) {
        assert(house.built === 1993);
        done();
      });
    });
    it('can put several records at once', function(done) {
      var houses = db.houses;
      var keys;
      houses.put({street: 'Somewhere 7', built: 1982},
                 {street: 'Somewhere 8', built: 1993},
                 {street: 'Somewhere 9', built: 2001})
      .then(function(putKeys) {
        keys = putKeys;
        return houses.get(keys[0]);
      }).then(function(house) {
        assert(house.built === 1982);
        return houses.get(keys[1]);
      }).then(function(house) {
        assert(house.built === 1993);
        return houses.get(keys[2]);
      }).then(function(house) {
        assert(house.built === 2001);
        done();
      });
    });
    /*
    it('can get records in a specified range', function(done) {
      db = syncedDB.open('mydb', 1, stores);
      var houses = db.houses;
      houses.put({street: 'Somewhere 1'},
                 {street: 'Somewhere 2'},
                 {street: 'Somewhere 3'},
                 {street: 'Somewhere 4'}
      ).then(function() {
        return houses.inRange({gt: 'Somewhere 2', lte: 'Somewhere 4'});
      }).then(function(foundHouses) {
        assert(foundHouses.length === 2);
        done();
      });
    });
    */
    describe('Index', function() {
      var db, put, animals;
      beforeEach(function() {
        db = syncedDB.open('mydb', 1, stores);
        animals = db.animals;
        put = animals.put({name: 'Thumper', race: 'rabbit', color: 'brown', key: 'rabbit1'},
                          {name: 'Fluffy', race: 'rabbit', color: 'white', key: 'rabbit2'},
                          {name: 'Bella', race: 'dog', color: 'white', key: 'dog1'});
      });
      it('supports getting by unique index', function(done) {
        var db = syncedDB.open('mydb', 1, stores);
        put.then(function() {
          return animals.byName.get('Thumper');
        }).then(function(thumper) {
          console.log(thumper);
          assert.equal(thumper.key, 'rabbit1');
          assert.equal(thumper.color, 'brown');
          done();
        });
      });
      it('can get multiple records', function(done) {
        put.then(function() {
          return animals.byColor.get('white');
        }).then(function(whiteAnimals) {
          assert(whiteAnimals[0].name === 'Bella');
          assert(whiteAnimals[1].name === 'Fluffy');
          done();
        });
      });
      it('return an array if store isnt unique', function(done) {
        put.then(function() {
          return animals.byColor.get('brown');
        }).then(function(brownAnimals) {
          assert(brownAnimals.length === 1);
          done();
        });
      });
    });
  });
  describe('Events', function() {
    var db;
    it('emits add event when creating record', function(done) {
      db = syncedDB.open('mydb', 1, stores);
      db.roads.on('add', function(e) {
        done();
      });
      db.roads.put({length: 100, price: 1337});
    });
    it('emits update event when modifying record', function(done) {
      db = syncedDB.open('mydb', 1, stores);
      var spy1 = sinon.spy();
      var spy2 = sinon.spy();
      db.roads.on('add', spy1);
      db.roads.on('update', spy2);
      var road = {length: 100, price: 1337};
      db.roads.put(road)
      .then(function() {
        return db.roads.put(road);
      }).then(function() {
        console.log(spy1.callCount);
        console.log(spy2.callCount);
        assert(spy1.calledOnce);
        assert(spy2.calledOnce);
        done();
      });
    });
    it('emits event when creating object inside transactions', function(done) {
      db = syncedDB.open('mydb', 1, stores);
      db.read('roads', function(s) {
        s.roads.put({length: 100, price: 1337});
      });
      db.roads.on('add', function(addedId) {
        done();
      });
    });
    it('add event contains the added record', function(done) {
      var record = {length: 100, price: 1337};
      db = syncedDB.open('mydb', 1, stores);
      db.roads.on('add', function(e) {
        assert.equal(record.length, e.record.length);
        assert.equal(record.price, e.record.price);
        done();
      });
      db.roads.put(record);
    });
  });
  describe('Syncing', function() {
    var db;
    var globalWebSocket = window.WebSocket;
    var ws, sendSpy;
    var onSend = function() {};
    beforeEach(function() {
      db = syncedDB.open('mydb', 1, stores);
      onSend = function() {};
      sendSpy = sinon.spy();
      window.WebSocket = function(url, protocol) {
        ws = new globalWebSocket('ws://localhost:3001');
        ws.send = function() {
          sendSpy.apply(null, arguments);
          onSend.apply(null, arguments);
        };
        return ws;
      };
    });
    afterEach(function() {
      window.WebSocket = globalWebSocket;
    });
    it('stores meta data when creating new record', function(done) {
      db.roads.on('add', function(e) {
        assert(e.record.changedSinceSync === 1);
        done();
      });
      db.roads.put({length: 100, price: 1337});
    });
    it('finds newly added records', function(done) {
      db.roads.put({length: 100, price: 1337})
      .then(function() {
        return db.roads.changedSinceSync.get(1);
      }).then(function(changedRoads) {
        assert(changedRoads.length === 1);
        done();
      });
    });
    describe('to server', function() {
      it('sends added record', function(done) {
        var road = {length: 100, price: 1337};
        onSend = function(msg) {
          ws.onmessage({data: JSON.stringify({
            type: 'ok',
            storeName: 'roads',
            key: 'foodle',
            newVersion: 0,
          })});
        };
        db.roads.put(road)
        .then(function(roadId) {
          return db.pushToRemote();
        })
        .then(function() {
          var sent = JSON.parse(sendSpy.getCall(0).args[0]);
          assert.deepEqual(sent.record, road);
          done();
        });
      });
      it('synchonized records are marked as unchanged', function(done) {
        var road = {length: 100, price: 1337};
        onSend = function(msg) {
          var sent = JSON.parse(msg);
          console.log(sent.record.key);
          ws.onmessage({data: JSON.stringify({
            type: 'ok',
            storeName: 'roads',
            key: sent.record.key,
            newVersion: 0,
          })});
        };
        db.roads.put(road)
        .then(function(roadId) {
          assert(road.changedSinceSync === 1);
          return db.pushToRemote();
        })
        .then(function() {
          console.log(road.key);
          return db.roads.get(road.key);
        }).then(function(road) {
          assert(road.changedSinceSync === 0);
          done();
        });
      });
    });
    describe('from server', function() {
      it('finishes sync if nr of records to sync is zero', function(done) {
        onSend = function(msg) {
          var data = JSON.parse(msg);
          assert.equal(data.type, 'get-changes');
          assert.deepEqual(data.storeNames, ['roads']);
          ws.onmessage({data: JSON.stringify({
            type: 'sending-changes',
            nrOfRecordsToSync: 0
          })});
        };
        db.pullFromRemote('roads')
        .then(function() {
          console.log('sync done');
          done();
        });
      });
      it('handles created documents', function(done) {
        onSend = function(msg) {
          var data = JSON.parse(msg);
          assert.equal(data.type, 'get-changes');
          assert.deepEqual(data.storeNames, ['roads']);
          ws.onmessage({data: JSON.stringify({
            type: 'sending-changes',
            nrOfRecordsToSync: 1
          })});
          ws.onmessage({data: JSON.stringify({
            type: 'create',
            storeName: 'roads',
            timestamp: 1,
            record: {version: 0, length: 133, price: 1000, key: 'foo'}
          })});
        };
        db.pullFromRemote('roads')
        .then(function() {
          return db.roads.byLength.get(133);
        }).then(function(road) {
          assert.equal(road[0].price, 1000);
          done();
        });
      });
      it('emits events for created documents', function(done) {
        var key;
        onSend = function(msg) {
          var data = JSON.parse(msg);
          assert(data.type === 'get-changes');
          ws.onmessage({data: JSON.stringify({
            type: 'sending-changes',
            nrOfRecordsToSync: 1
          })});
          ws.onmessage({data: JSON.stringify({
            type: 'create',
            storeName: 'roads',
            timestamp: 1,
            record: {version: 0, length: 133, price: 1000, key: 'foo'}
          })});
        };
        db.roads.on('add', function(e) {
          key = e.record.key;
        });
        db.pullFromRemote('roads')
        .then(function() {
          console.log(key);
          assert.equal(key, 'foo');
          done();
        });
      });
    });
   });
});