
// const Redis = require('ioredis');
const redis = require('redis');
const Promise = require('bluebird');

// const Command = Redis.Command;

class Tile38 {

    constructor({ port = 9851, host = 'localhost', debug = false } = {}) {
        this.client = redis.createClient({ port, host });
        // put the OUTPUT in json mode
        this.sendCommand('OUTPUT', null, 'json');
        this.debug = debug;
    }

    /*
     * send a command with optional arguments to the Redis driver, and return the response in a Promise.
     * If returnProp is set, it will assume that the response is a JSON string, then parse and return
     * the given property from that string.
     */
    sendCommand(cmd, returnProp, args) {
        // make args an array if it's not already one
        if (!args) {
            args = []
        } else if (!Array.isArray(args)) {
            args = [args];
        }
        return new Promise((resolve, reject) => {
            if (this.debug) {
                console.log(`sending command "${cmd} ${args.join(' ')}"`);
            }
            this.client.send_command(cmd, args, (err, result) => {
                if (err) {
                    if (this.debug) {
                        console.log(err);
                    }
                    reject(err);
                } else {
                    if (this.debug) {
                        console.log(result);
                    }
                    try {
                        if (!returnProp) {
                            // return the raw response
                            resolve(result);
                        } else {
                            let res = JSON.parse(result);
                            if (!res.ok) {
                                if (res.err) {
                                    reject(res.err);
                                } else {
                                    reject(`unexpected response: ${result}`);
                                }
                            } else {
                                if (returnProp == 1) {
                                    // 1 has a special meaning. Return the entire response minus
                                    // 'ok' and 'elapsed' properties
                                    delete res.ok;
                                    delete res.elapsed;
                                    resolve(res);
                                } else {
                                    resolve(res[returnProp]);
                                }
                            }
                        }
                    } catch (error) {
                        reject(`unable to parse response: ${result}`);
                    }
                }
            });
        });
    }

    // calls the PING command and returns a promise to the expected PONG response
    ping() {
        return this.sendCommand('PING', 'ping');
    }

    quit() {
        return this.sendCommand('QUIT');
    }

    server() {
        return this.sendCommand('SERVER', 'stats');
    }

    // force the garbage collector
    gc() {
        return this.sendCommand('GC', 'ok');
    }

    configGet(prop) {
        return this.sendCommand('CONFIG GET', 'properties', prop);
    }

    // sets a configuration value in the database. Will return true if successful.
    // Note that the value does not get persisted until configRewrite is called.
    configSet(prop, value) {
        return this.sendCommand('CONFIG SET', 'ok', [prop, value]);
    }

    // persists changes made by configSet command. Will return true if successful
    configRewrite() {
        return this.sendCommand('CONFIG REWRITE', 'ok');
    }

    // flushes all data from the db. Will return true value if successful
    flushdb() {
        return this.sendCommand('FLUSHDB', 'ok');
    }

    // turns on or off readonly mode. (Pass true value to turn on)
    readOnly(val) {
        return this.sendCommand('READONLY', 'ok', (val ? 'yes' : 'no'));
    }

    // Returns the minimum bounding rectangle for all objects in a key.
    bounds(key) {
        return this.sendCommand('BOUNDS', 'bounds', key);
    }

    // Set a timeout on an id.
    expire(key, id, seconds) {
        return this.sendCommand('EXPIRE', 'ok', [key, id, seconds]);
    }

    // Get a timeout on an id
    ttl(key, id) {
        return this.sendCommand('TTL', 'ttl', [key, id]);
    }

    persist(key, id) {
        return this.sendCommand('PERSIST', 'ok', [key, id]);
    }

    // Returns all keys matching pattern.
    keys(pattern) {
        return this.sendCommand('KEYS', 'keys', pattern);
    }


    /* obj can be one of the following:
     *   - an array with lat, lng and optional z coordinate, representing a point.
     *   - an array of 4 coordinates, representing a bounding box.
     *   - a string representing a Geohash
     *   - a GeoJson object.
     * fields should be a simple object with key value pairs
     * opts can be used to set additional options, such as:
     *   - expire: 3600          // to set expiration date of object
     *   - onlyIfExists: true    // only set field if key already exists
     *   - onlyIfNotExists: true // only set if id does not exist yet
     *   - type: 'string'        // to set string values (otherwise interpreted as geohash)
     * Examples:
     *
     * // set a simple lat/lng coordinate
     * set('fleet', 'truck1', [33.5123, -112.2693])
     * // set with additional fields
     * set('fleet', 'truck1', [33.5123, -112.2693], { field1: 10, field2: 20});
     * // set lat/lon/alt coordinates, and expire in 120 secs
     * set('fleet', 'truck1', [33.5123, -112.2693, 120.0], {}, {expire: 120})
     * // set bounds
     * set('props', 'house1', [33.7840, -112.1520, 33.7848, -112.1512])
     * // set an ID by geohash
     * set('props', 'area1', '9tbnwg')   // assumes HASH by default if only one extra parameter
     * // set a String value
     * set('props', 'area2', 'my string value', {}, {type: 'string'}) # or force to String type
     * // set with geoJson object
     * set('cities', 'tempe', geoJsonObject)
     *
     */
    set(key, id, obj, fields = {}, opts = {}) {
        let cmd = [key, id];
        for (let f in fields) {
            cmd = cmd.concat(['FIELD', f, fields[f]]);
        }
        let expire = opts['expire'];
        if (expire > 0) {
            cmd.push('EX');
            cmd.push(expire);
        }
        if (opts['onlyIfNotExists']) {
            cmd.push('NX');
        }
        if (opts['onlyIfExists']) {
            cmd.push('XX');
        }
        if (Array.isArray(obj)) {
            // if obj is an array, it must be either POINT or BOUNDS
            if (obj.length < 4) {
                cmd.push('POINT');
                cmd = cmd.concat(obj);
            } else if (obj.length == 4) {
                cmd.push('BOUNDS');
                cmd = cmd.concat(obj);
            } else {
                throw Error("incorrect number of values");
            }
        } else if (typeof obj == 'string') {
            // if obj is a string, it must be String or geohash
            if (opts['type'] == 'string') {
                cmd.push('STRING');
                cmd.push(`"${obj}"`);
            } else {
                cmd.push('HASH');
                cmd.push(obj);
            }
        } else {
            // must be a Geojson object
            cmd.push(JSON.stringify(obj));
        }
        return this.sendCommand('SET', 'ok', cmd);
    }

    // Set the value for a single field of an id.
    fset(key, id, field, value) {
        return this.sendCommand('FSET', 'ok', [key, id, field, value]);
    }

    // Delete an id from a key
    del(key, id) {
        return this.sendCommand('DEL', 'ok', [key, id]);
    }

    // Removes objects that match a specified pattern.
    pdel(key, pattern) {
        return this.sendCommand('PDEL', 'ok', [key, pattern]);
    }

    //
    /*
     * Get the object of an id. The default output format is a GeoJSON object.
     *
     *   The options hash supports 3 properties:
     *   type: (POINT, BOUNDS, HASH, OBJECT)  the type in which to return the ID. Defaults to OBJECT
     *   withfields:  boolean to indicate whether or not fields should be returned. Defaults to false
     *   precision:   only applicable if type = 'HASH'. Sets precision to use for returned Hash value.
     *
     * examples:
     *   get('fleet', 'truck1')                    // returns geojson point
     *   get('fleet', 'truck1', {withfields: true} // include FIELDS
     *   get('fleet', 'truck1', {type: 'POINT'})   // same as above
     *   get('fleet', 'truck1', {type: 'BOUNDS'})  // return bounds
     *   get('fleet', 'truck1', {type: 'HASH', precision: 6} // return geohash
     */
    get(key, id, { withfields = false, type= null, precision = null } = {}) {

        let params = [key, id];
        if (withfields) params.push('WITHFIELDS');

        if (type == 'HASH') {
            // geohash requested, add precision if set
            params.push('HASH');
            if (precision != null) params.push(precision);
        } else if (type != null) {
            params.push(type)
        }
        return this.sendCommand('GET', 1, params);
    }

    // shortcut for GET method with output POINT
    getPoint(key, id, opts = {}) {
        opts.type = 'POINT';
        return this.get(key, id, opts);
    }

    // shortcut for GET method with output BOUNDS
    getBounds(key, id, opts = {}) {
        opts.type = 'BOUNDS';
        return this.get(key, id, opts);
    }

    // shortcut for GET method with output HASH
    getHash(key, id, opts = {}) {
        opts.type = 'HASH';
        return this.get(key, id, arguments[2]);
    }

    // Remove all objects from specified key.
    drop(key) {
         return this.sendCommand('DROP', 'ok', key);
    }

    // Return stats for one or more keys.
    stats(...keys) {
         return this.sendCommand('STATS', 'stats', keys);
    }

    // Set a value in a JSON document
    jset(key, id, jKey, jVal) {
        return this.sendCommand('JSET', 'ok', [key, id, jKey, jVal]);
    }

    // Get a value from a json document
    jget(key, id, ...other) {
        let params = [key, id]
        params = params.concat(other)
        return this.sendCommand('JGET', 'value', params);
    }

    // Delete a json value
    jdel(key, id, jKey) {
        return this.sendCommand('JDEL', 'ok', [key, id, jKey]);
    }

    // incrementally iterates though a key
    // TODO: implement all SCAN options. This currently only scans for all objects in the key.
    scan(key) {
        return this.sendCommand('SCAN', 1, key);
    }
}

module.exports = Tile38