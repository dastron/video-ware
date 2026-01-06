/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Tasks_modify_progress = app.findCollectionByNameOrId("Tasks");
  const collection_Tasks_modify_progress_field = collection_Tasks_modify_progress.fields.getByName("progress");

  collection_Tasks_modify_progress_field.required = false;

  app.save(collection_Tasks_modify_progress);

  const collection_Tasks_modify_attempts = app.findCollectionByNameOrId("Tasks");
  const collection_Tasks_modify_attempts_field = collection_Tasks_modify_attempts.fields.getByName("attempts");

  collection_Tasks_modify_attempts_field.required = false;

  app.save(collection_Tasks_modify_attempts);

  const collection_Tasks_remove_MediaRef = app.findCollectionByNameOrId("Tasks");
  const collection_Tasks_remove_MediaRef_field = collection_Tasks_remove_MediaRef.fields.getByName("MediaRef");

  collection_Tasks_remove_MediaRef.fields.removeById(collection_Tasks_remove_MediaRef_field.id);

  app.save(collection_Tasks_remove_MediaRef);

  const collection_Tasks_remove_UserRef = app.findCollectionByNameOrId("Tasks");
  const collection_Tasks_remove_UserRef_field = collection_Tasks_remove_UserRef.fields.getByName("UserRef");

  collection_Tasks_remove_UserRef.fields.removeById(collection_Tasks_remove_UserRef_field.id);

  return app.save(collection_Tasks_remove_UserRef);
}, (app) => {
  const collection_Tasks_restore_MediaRef = app.findCollectionByNameOrId("Tasks");

  collection_Tasks_restore_MediaRef.fields.add(new RelationField({
    name: "MediaRef",
    required: false,
    collectionId: app.findCollectionByNameOrId("pbc_1621831907").id,
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_Tasks_restore_MediaRef);

  const collection_Tasks_restore_UserRef = app.findCollectionByNameOrId("Tasks");

  collection_Tasks_restore_UserRef.fields.add(new RelationField({
    name: "UserRef",
    required: false,
    collectionId: "_pb_users_auth_",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_Tasks_restore_UserRef);

  const collection_Tasks_revert_progress = app.findCollectionByNameOrId("Tasks");
  const collection_Tasks_revert_progress_field = collection_Tasks_revert_progress.fields.getByName("progress");

  collection_Tasks_revert_progress_field.required = true;

  app.save(collection_Tasks_revert_progress);

  const collection_Tasks_revert_attempts = app.findCollectionByNameOrId("Tasks");
  const collection_Tasks_revert_attempts_field = collection_Tasks_revert_attempts.fields.getByName("attempts");

  collection_Tasks_revert_attempts_field.required = true;

  return app.save(collection_Tasks_revert_attempts);
});
