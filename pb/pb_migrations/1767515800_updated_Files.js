/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const collection = app.findCollectionByNameOrId("pbc_213045686")

    // add field
    collection.fields.addAt(12, new Field({
        "cascadeDelete": false,
        "collectionId": "pbc_3372169582",
        "hidden": false,
        "id": "relation3372169582",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "UploadRef",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
    }))

    return app.save(collection)
}, (app) => {
    const collection = app.findCollectionByNameOrId("pbc_213045686")

    // remove field
    collection.fields.removeById("relation3372169582")

    return app.save(collection)
})
