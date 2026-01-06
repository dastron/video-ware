/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_213045686")

  // update field
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "file2961155532",
    "maxSelect": 0,
    "maxSize": 700000000,
    "mimeTypes": [],
    "name": "blob",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": null,
    "type": "file"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_213045686")

  // update field
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "file2961155532",
    "maxSelect": 0,
    "maxSize": 705032704,
    "mimeTypes": [],
    "name": "blob",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": null,
    "type": "file"
  }))

  return app.save(collection)
})
