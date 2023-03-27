'use strict'

/*
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

const fs = require('fs')
const Log = require('./simple-logger')
const AppDefs = require('./app-defs')

// load and parse config file
function LoadConfig () {
  const args = process.argv.slice(2)

  var confFileArg = null
  if (args.length > 2) confFileArg = args[2]
  var mongodb_name = process.env.JSON_SCADA_MONGODB_NAME
  var db_hostname = process.env.MONGODB_HOSTNAME

  var jsConfigFileObject = {
    nodeName: process.env.NODE_NAME,
    mongoConnectionString: `mongodb://${db_hostname}:27017/${mongodb_name}?replicaSet=rs1`,
    mongoDatabaseName: process.env.JSON_SCADA_MONGODB_NAME
  }
  var jsConfigFile = JSON.stringify(jsConfigFileObject)
  if (args.length > 2) confFileArg = args[2]

  let configFile =
    confFileArg || process.env.JS_CONFIG_FILE || jsConfigFile //'../../conf/json-scada.json'
  Log.log('Config - Config File: ' + configFile)

  //if (!fs.existsSync(configFile)) {
  //  Log.log('Config - Error: config file not found!')
  //  process.exit()
  //}

  //let rawFileContents = fs.readFileSync(configFile)
  //let configObj = JSON.parse(rawFileContents)
  let configObj = jsConfigFileObject
  if (
    typeof configObj.mongoConnectionString != 'string' ||
    configObj.mongoConnectionString === ''
  ) {
    Log.log('Error reading config file.')
    process.exit()
  }

  Log.levelCurrent = Log.levelNormal
  if (AppDefs.ENV_PREFIX + 'LOGLEVEL' in process.env)
    Log.levelCurrent = process.env[AppDefs.ENV_PREFIX + 'LOGLEVEL']
  if (args.length > 1) Log.levelCurrent = parseInt(args[1])
  configObj.LogLevel = Log.levelCurrent

  var instArg = null
  if (args.length > 0) instArg = parseInt(args[0])
  configObj.Instance =
    instArg || process.env[AppDefs.ENV_PREFIX + 'INSTANCE'] || 1

  configObj.GridFsCollectionName = 'files'
  configObj.RealtimeDataCollectionName = 'realtimeData'
  configObj.SoeDataCollectionName = 'soeData'
  configObj.CommandsQueueCollectionName = 'commandsQueue'
  configObj.ProtocolDriverInstancesCollectionName = 'protocolDriverInstances'
  configObj.ProtocolConnectionsCollectionName = 'protocolConnections'
  configObj.GroupSep = '~'
  configObj.ConnectionNumber = 0

  Log.log('Config - ' + AppDefs.MSG + ' Version ' + AppDefs.VERSION)
  Log.log('Config - Instance: ' + configObj.Instance)
  Log.log('Config - Log level: ' + Log.levelCurrent)

  return configObj
}

module.exports = LoadConfig
