/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_641443944")

  // update field
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "number2254405824",
    "max": null,
    "min": 0,
    "name": "duration",
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
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "number2254405824",
    "max": null,
    "min": 0,
    "name": "duration",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
})
