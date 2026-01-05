/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_641443944")

  // update field
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "number2675529103",
    "max": null,
    "min": 0,
    "name": "start",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_641443944")

  // update field
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "number2675529103",
    "max": null,
    "min": 0,
    "name": "start",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
})
