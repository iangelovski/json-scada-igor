'use strict'

/*
 * Customizable processor of mongodb changes via change streams.
 * DO NOT EDIT THIS FILE! CUSTOMIZE THE customized_module.js file
 * {json:scada} - Copyright (c) 2020-2021 - Ricardo L. Olsen
 * This file is part of the JSON-SCADA distribution (https://github.com/riclolsen/json-scada).
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

const APP_NAME = 'CS_CUSTOM_PROCESSOR'
const APP_MSG = '{json:scada} - Change Stream Custom Processor'
const VERSION = '0.1.1'
let ProcessActive = false // for redundancy control
//var jsConfigFile = '../../conf/json-scada.json'

const mongodb_name = process.env.JSON_SCADA_DB_NAME
const db_hostname = process.env.MONGODB_HOSTNAME

const jsConfigFile = {
  nodeName: process.env.NODE_NAME,
  mongoConnectionString: `mongodb://${db_hostname}:27017/${mongodb_name}?replicaSet=rs1`,
  mongoDatabaseName: process.env.JSON_SCADA_MONGODB_NAME
}

const fs = require('fs')
const { MongoClient, Double, ReadPreference } = require('mongodb')
const Queue = require('queue-fifo')
const { setInterval } = require('timers')
const CustomProcessor = require('./customized_module').CustomProcessor

const LogLevelMin = 0,
  LogLevelNormal = 1,
  LogLevelDetailed = 2,
  LogLevelDebug = 3

const args = process.argv.slice(2)
var inst = null
if (args.length > 0) inst = parseInt(args[0])
const Instance = inst || process.env.JS_CSCUSTOMPROC_INSTANCE || 1

var logLevel = null
if (args.length > 1) logLevel = parseInt(args[1])
const LogLevel = logLevel || process.env.JS_CSCUSTOMPROC_LOGLEVEL || 1

var confFile = null
if (args.length > 2) confFile = args[2]
jsConfigFile = confFile || process.env.JS_CONFIG_FILE || jsConfigFile

console.log(APP_MSG + ' Version ' + VERSION)
console.log('Instance: ' + Instance)
console.log('Log level: ' + LogLevel)
console.log('Config File: ' + jsConfigFile)

if (!fs.existsSync(jsConfigFile)) {
  console.log('Error: config file not found!')
  process.exit()
}

const RealtimeDataCollectionName = 'realtimeData'
const ProcessInstancesCollectionName = 'processInstances'
const ProtocolDriverInstancesCollectionName = 'protocolDriverInstances'
const ProtocolConnectionsCollectionName = 'protocolConnections'

let rawFileContents = fs.readFileSync(jsConfigFile)
let jsConfig = JSON.parse(rawFileContents)
if (
  typeof jsConfig.mongoConnectionString != 'string' ||
  jsConfig.mongoConnectionString === ''
) {
  console.log('Error reading config file.')
  process.exit()
}

console.log('Connecting to MongoDB server...')

;(async () => {
  let connOptions = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    appname: APP_NAME + ' Version:' + VERSION + ' Instance:' + Instance,
    poolSize: 20,
    readPreference: ReadPreference.PRIMARY
  }

  if (
    typeof jsConfig.tlsCaPemFile === 'string' &&
    jsConfig.tlsCaPemFile.trim() !== ''
  ) {
    jsConfig.tlsClientKeyPassword = jsConfig.tlsClientKeyPassword || ''
    jsConfig.tlsAllowInvalidHostnames =
      jsConfig.tlsAllowInvalidHostnames || false
    jsConfig.tlsAllowChainErrors = jsConfig.tlsAllowChainErrors || false
    jsConfig.tlsInsecure = jsConfig.tlsInsecure || false

    connOptions.tls = true
    connOptions.tlsCAFile = jsConfig.tlsCaPemFile
    connOptions.tlsCertificateKeyFile = jsConfig.tlsClientPemFile
    connOptions.tlsCertificateKeyFilePassword = jsConfig.tlsClientKeyPassword
    connOptions.tlsAllowInvalidHostnames = jsConfig.tlsAllowInvalidHostnames
    connOptions.tlsInsecure = jsConfig.tlsInsecure
  }

  let clientMongo = null
  let redundancyIntervalHandle = null
  while (true) {
    if (clientMongo === null)
      await MongoClient.connect(jsConfig.mongoConnectionString, connOptions)
        .then(async client => {
          clientMongo = client
          const db = clientMongo.db(jsConfig.mongoDatabaseName)
          console.log('Connected correctly to MongoDB server')

          jsConfig.processActive = ProcessActive
          CustomProcessor(clientMongo, jsConfig)

          let lastActiveNodeKeepAliveTimeTag = null
          let countKeepAliveNotUpdated = 0
          let countKeepAliveUpdatesLimit = 4
          async function ProcessRedundancy () {
            if (!clientMongo) return
            // look for process instance entry, if not found create a new entry
            db.collection(ProcessInstancesCollectionName)
              .find({
                processName: APP_NAME,
                processInstanceNumber: Instance
              })
              .toArray(function (err, results) {
                if (err) console.log(err)
                else if (results) {
                  
                  if (LogLevel >= LogLevelNormal)
                    console.log('Redundancy - Process ' + (ProcessActive?"Active":"Inactive"))
      
                  if (results.length == 0) {
                    // not found, then create
                    ProcessActive = true
                    console.log('Redundancy - Instance config not found, creating one...')
                    db.collection(ProcessInstancesCollectionName).insertOne({
                      processName: APP_NAME,
                      processInstanceNumber: new Double(Instance),
                      enabled: true,
                      logLevel: new Double(1),
                      nodeNames: [],
                      activeNodeName: jsConfig.nodeName,
                      activeNodeKeepAliveTimeTag: new Date()
                    })
                  } else {
                    // check for disabled or node not allowed
                    let instance = results[0]
                    if (instance?.enabled === false) {
                      console.log('Redundancy - Instance disabled, exiting...')
                      process.exit()
                    }
                    if (
                      instance?.nodeNames !== null &&
                      instance.nodeNames.length > 0
                    ) {
                      if (!instance.nodeNames.includes(jsConfig.nodeName)) {
                        console.log('Redundancy - Node name not allowed, exiting...')
                        process.exit()
                      }
                    }
                    if (instance?.activeNodeName === jsConfig.nodeName) {
                      if (!ProcessActive) console.log('Redundancy - Node activated!')
                      countKeepAliveNotUpdated = 0
                      ProcessActive = true
                    } else {
                      // other node active
                      if (ProcessActive) {
                        console.log('Redundancy - Node deactivated!')
                        countKeepAliveNotUpdated = 0
                      }
                      ProcessActive = false
                      if (
                        lastActiveNodeKeepAliveTimeTag ===
                        instance.activeNodeKeepAliveTimeTag.toISOString()
                      ) {
                        countKeepAliveNotUpdated++
                        console.log(
                          'Redundancy - Keep-alive from active node not updated. ' +
                            countKeepAliveNotUpdated
                        )
                      } else {
                        countKeepAliveNotUpdated = 0
                        console.log(
                          'Redundancy - Keep-alive updated by active node. Staying inactive.'
                        )
                      }
                      lastActiveNodeKeepAliveTimeTag = instance.activeNodeKeepAliveTimeTag.toISOString()
                      if (
                        countKeepAliveNotUpdated > countKeepAliveUpdatesLimit
                      ) {
                        // cnt exceeded, be active
                        countKeepAliveNotUpdated = 0
                        console.log('Redundancy - Node activated!')
                        ProcessActive = true
                      }
                    }
                    
                    jsConfig.processActive = ProcessActive

                    if (ProcessActive) {
                      // process active, then update keep alive
                      db.collection(ProcessInstancesCollectionName).updateOne(
                        {
                          processName: APP_NAME,
                          processInstanceNumber: new Double(Instance)
                        },
                        {
                          $set: {
                            activeNodeName: jsConfig.nodeName,
                            activeNodeKeepAliveTimeTag: new Date(),
                            softwareVersion: VERSION,
                            stats: {}
                          }
                        }
                      )
                    }
                  }
                }
              })
          }

          // check and update redundancy control
          ProcessRedundancy()
          clearInterval(redundancyIntervalHandle)
          redundancyIntervalHandle = setInterval(ProcessRedundancy, 5000)
        })
        .catch(function (err) {
          if (clientMongo) clientMongo.close()
          clientMongo = null
          console.log(err)
        })

    // wait 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000))

    // detect connection problems, if error will null the client to later reconnect
    if (clientMongo === undefined) {
      console.log('Disconnected Mongodb!')
      clientMongo = null
    }
    if (clientMongo)
      if (!clientMongo.isConnected()) {
        // not anymore connected, will retry
        console.log('Disconnected Mongodb!')
        clientMongo.close()
        clientMongo = null
      }
  }
})()
