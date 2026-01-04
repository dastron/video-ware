/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3372169582")

  // update field
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "file335778138",
    "maxSelect": 0,
    "maxSize": 700000000,
    "mimeTypes": [],
    "name": "originalFile",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": null,
    "type": "file"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3372169582")

  // update field
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "file335778138",
    "maxSelect": 0,
    "maxSize": 0,
    "mimeTypes": null,
    "name": "originalFile",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": null,
    "type": "file"
  }))

  return app.save(collection)
})
