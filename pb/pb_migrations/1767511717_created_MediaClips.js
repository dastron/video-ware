/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // UP MIGRATION

  // Create new collections
  const collection_MediaClips_create = new Collection({
    id: "pbc_641443944",
    name: "MediaClips",
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
      name: "MediaRef",
      type: "relation",
      required: true,
      collectionId: "pbc_1621831907",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
    {
      name: "clipType",
      type: "text",
      required: true,
    },
    {
      name: "start",
      type: "number",
      required: true,
      min: 0,
    },
    {
      name: "end",
      type: "number",
      required: true,
      min: 0,
    },
    {
      name: "duration",
      type: "number",
      required: true,
      min: 0,
    },
    {
      name: "clipData",
      type: "json",
      required: false,
    },
  ],
    indexes: [],
  });

  return app.save(collection_MediaClips_create);

}, (app) => {
  // DOWN MIGRATION (ROLLBACK)

  // Delete created collections
  const collection_MediaClips_rollback = app.findCollectionByNameOrId("MediaClips");
  return app.delete(collection_MediaClips_rollback);

});
