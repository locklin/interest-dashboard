/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const {createNode} = require("streams/core");
const {storage} = require("sdk/simple-storage");
const {TypeNamespace} = require("TypeNamespace");
const {DataProcessorHelper} = require("Utils");
const {data} = require("sdk/self");
const {Cu, Cc, Ci} = require("chrome");
Cu.import("resource://gre/modules/Services.jsm");

/*
 * Takes chartData messages and manipulates the data
 * to be suitable for the spider chart
 */
let count = 0;

let SpiderDataProcessorBolt = {
  create: function _SDPB_create(storageBackend) {
    let node = createNode({
      _spiderInput: {"children": {}, "weight": 100},
      MAX_NODE_RADIUS: 100,
      MIN_NODE_RADIUS: 30,
      identifier: "spiderDataProcessorBolt",
      listenType: "chartData", // Can also listen to other chart data processors
      emitType: "spiderData",

      _scaleGraphWeights: function() {
        let oldRange = (this._maxWeight - this._minWeight);
        let newRange = (this.MAX_NODE_RADIUS - this.MIN_NODE_RADIUS);
        for (let i in this._originalNodes) {
          let node = this._originalNodes[i];
          //if (node.id == 0) continue;
          node["radius"] = (((node["radius"] - this._minWeight) * newRange) / oldRange) + 30;
        }
      },

      _populateGraphDFS: function(root, parentID) {
        if (Object.keys(root).length > 0) {
          for (var child in root) {
            var currLength = this._originalNodes.length;
            var weight = root[child]["weight"];
            if (weight == 0) {
              continue;
            }
            if (weight < this._minWeight) {
              this._minWeight = weight;
            }

            var hasChildren = root[child]["children"];
            this._originalNodes.push({"id": currLength, "radius": weight, "name": child});
            this._links.push({"source": parentID, "target": currLength});
            if (hasChildren) {
              this._populateGraphDFS(root[child]["children"], currLength);
            }
          }
        }
      },

      // Makes a copy of the existing hierarchy and adds weights to it where applicable
      _addWeightsToHierarchy: function(hierarchyRoot, interestsRoot, categories) {
        let weight = 0;
        if (Object.keys(hierarchyRoot).length > 0) {
          for (var child in hierarchyRoot) {
            if (!interestsRoot["children"][child] &&
                (Object.keys(hierarchyRoot[child]).length > 0 || categories[child])) {
              interestsRoot["children"][child] = {"children": {}};
            }
            if (categories[child]) {
              let childWeight = categories[child]["visitCount"];
              interestsRoot["children"][child]["weight"] = childWeight;
              weight += childWeight;
            }
            weight += this._addWeightsToHierarchy(hierarchyRoot[child], interestsRoot["children"][child], categories);
            interestsRoot["weight"] = weight;
          }
        }
        return weight;
      },

      ingest: function _HSB_ingest(message) {
        DataProcessorHelper.initChartInStorage("spiderData", this.storage);

        let scriptLoader = Cc["@mozilla.org/moz/jssubscript-loader;1"].getService(Ci.mozIJSSubScriptLoader);
        scriptLoader.loadSubScript(data.url("models/en-US/hierarchy.js"));
        let spiderTypeNamespace = message["keywords"]["edrules"];

        this._minWeight = 1000000000;
        this._originalNodes = [{"id": 0,
                                "name": "YOU",
                                "fixed": true}];
        this._links = [];
        this._addWeightsToHierarchy(hierarchy, this._spiderInput, spiderTypeNamespace.categories);
        this._populateGraphDFS(this._spiderInput["children"], 0);
        this._originalNodes[0]["radius"] = this._maxWeight = this._spiderInput["weight"];
        this._scaleGraphWeights();

        this.storage.chartData.spiderData.nodes = this._originalNodes;
        this.storage.chartData.spiderData.links = this._links;

        if (count == 0) {
          Services.obs.notifyObservers(null, "chart-update",
            JSON.stringify({"type": "spider", "data": this.storage.chartData.spiderData}));
          count++;
        }

        this.results = message;
      },
    }, {storage: storageBackend || storage});
    return node;
  }
}

exports.SpiderDataProcessorBolt = SpiderDataProcessorBolt;