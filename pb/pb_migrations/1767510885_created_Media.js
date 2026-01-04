/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // UP MIGRATION

  // Create new collections
  const collection_Media_create = new Collection({
    id: "pbc_1621831907",
    name: "Media",
    type: "base",
    listRule: "@request.auth.id != \"\"",
    viewRule: "@request.auth.id != \"\"",
    createRule: "@request.auth.id != \"\"",
    updateRule: "@request.auth.id != \"\"",
    deleteRule: "@request.auth.id != \"\"",
    manageRule: null,
    fields: [
    {
      name: "id",
      type: "text",
      required: true,
      autogeneratePattern: "[a-z0-9]{15}",
      hidden: false,
      id: "text3208210256",
      max: 15,
      min: 15,
      pattern: "^[a-z0-9]+$",
      presentable: false,
      primaryKey: true,
      system: true,
    },
    {
      name: "created",
      type: "autodate",
      required: true,
      hidden: false,
      id: "autodate2990389176",
      onCreate: true,
      onUpdate: false,
      presentable: false,
      system: false,
    },
    {
      name: "updated",
      type: "autodate",
      required: true,
      hidden: false,
      id: "autodate3332085495",
      onCreate: true,
      onUpdate: true,
      presentable: false,
      system: false,
    },
    {
      name: "WorkspaceRef",
      type: "relation",
      required: true,
      collectionId: "pbc_3456483467",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
    {
      name: "UploadRef",
      type: "relation",
      required: true,
      collectionId: "pbc_3372169582",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
    {
      name: "mediaType",
      type: "select",
      required: true,
      values: ["video", "audio", "image"],
      maxSelect: 1,
    },
    {
      name: "duration",
      type: "number",
      required: true,
      min: 0,
    },
    {
      name: "mediaData",
      type: "json",
      required: true,
    },
    {
      name: "thumbnailFile",
      type: "text",
      required: false,
    },
    {
      name: "spriteFile",
      type: "text",
      required: false,
    },
    {
      name: "processingVersion",
      type: "number",
      required: false,
    },
  ],
    indexes: [],
  });

  return app.save(collection_Media_create);

}, (app) => {
  // DOWN MIGRATION (ROLLBACK)

  // Delete created collections
  const collection_Media_rollback = app.findCollectionByNameOrId("Media");
  return app.delete(collection_Media_rollback);

});
