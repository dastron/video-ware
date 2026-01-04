/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // UP MIGRATION

  // Create new collections
  const collection_Tasks_create = new Collection({
    id: "pbc_1524626552",
    name: "Tasks",
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
      name: "sourceType",
      type: "text",
      required: true,
    },
    {
      name: "sourceId",
      type: "text",
      required: true,
    },
    {
      name: "type",
      type: "text",
      required: true,
    },
    {
      name: "status",
      type: "select",
      required: true,
      values: ["queued", "running", "success", "failed", "canceled"],
      maxSelect: 1,
    },
    {
      name: "progress",
      type: "number",
      required: true,
      min: 0,
      max: 100,
    },
    {
      name: "attempts",
      type: "number",
      required: true,
      min: 0,
    },
    {
      name: "payload",
      type: "json",
      required: true,
    },
    {
      name: "result",
      type: "json",
      required: false,
    },
    {
      name: "errorLog",
      type: "text",
      required: false,
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
      required: false,
      collectionId: "pbc_1621831907",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
    {
      name: "UserRef",
      type: "relation",
      required: false,
      collectionId: "_pb_users_auth_",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    },
    {
      name: "provider",
      type: "select",
      required: false,
      values: ["ffmpeg", "google_transcoder", "google_video_intelligence", "google_speech"],
      maxSelect: 1,
    },
    {
      name: "version",
      type: "text",
      required: false,
    },
  ],
    indexes: [],
  });

  return app.save(collection_Tasks_create);

}, (app) => {
  // DOWN MIGRATION (ROLLBACK)

  // Delete created collections
  const collection_Tasks_rollback = app.findCollectionByNameOrId("Tasks");
  return app.delete(collection_Tasks_rollback);

});
