/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_MediaClips_add_type = app.findCollectionByNameOrId("MediaClips");

  collection_MediaClips_add_type.fields.add(new TextField({
    name: "type",
    required: true
  }));

  app.save(collection_MediaClips_add_type);

  const collection_MediaClips_modify_start = app.findCollectionByNameOrId("MediaClips");
  const collection_MediaClips_modify_start_field = collection_MediaClips_modify_start.fields.getByName("start");

  collection_MediaClips_modify_start_field.required = false;

  app.save(collection_MediaClips_modify_start);

  const collection_MediaClips_modify_end = app.findCollectionByNameOrId("MediaClips");
  const collection_MediaClips_modify_end_field = collection_MediaClips_modify_end.fields.getByName("end");

  collection_MediaClips_modify_end_field.required = false;

  app.save(collection_MediaClips_modify_end);

  const collection_MediaClips_modify_duration = app.findCollectionByNameOrId("MediaClips");
  const collection_MediaClips_modify_duration_field = collection_MediaClips_modify_duration.fields.getByName("duration");

  collection_MediaClips_modify_duration_field.required = false;

  app.save(collection_MediaClips_modify_duration);

  const collection_MediaClips_remove_clipType = app.findCollectionByNameOrId("MediaClips");
  const collection_MediaClips_remove_clipType_field = collection_MediaClips_remove_clipType.fields.getByName("clipType");

  collection_MediaClips_remove_clipType.fields.removeById(collection_MediaClips_remove_clipType_field.id);

  return app.save(collection_MediaClips_remove_clipType);
}, (app) => {
  const collection_MediaClips_restore_clipType = app.findCollectionByNameOrId("MediaClips");

  collection_MediaClips_restore_clipType.fields.add(new TextField({
    name: "clipType",
    required: true
  }));

  app.save(collection_MediaClips_restore_clipType);

  const collection_MediaClips_revert_start = app.findCollectionByNameOrId("MediaClips");
  const collection_MediaClips_revert_start_field = collection_MediaClips_revert_start.fields.getByName("start");

  collection_MediaClips_revert_start_field.required = true;

  app.save(collection_MediaClips_revert_start);

  const collection_MediaClips_revert_end = app.findCollectionByNameOrId("MediaClips");
  const collection_MediaClips_revert_end_field = collection_MediaClips_revert_end.fields.getByName("end");

  collection_MediaClips_revert_end_field.required = true;

  app.save(collection_MediaClips_revert_end);

  const collection_MediaClips_revert_duration = app.findCollectionByNameOrId("MediaClips");
  const collection_MediaClips_revert_duration_field = collection_MediaClips_revert_duration.fields.getByName("duration");

  collection_MediaClips_revert_duration_field.required = true;

  app.save(collection_MediaClips_revert_duration);

  const collection_MediaClips_revert_add_type = app.findCollectionByNameOrId("MediaClips");
  const collection_MediaClips_revert_add_type_field = collection_MediaClips_revert_add_type.fields.getByName("type");

  collection_MediaClips_revert_add_type.fields.removeById(collection_MediaClips_revert_add_type_field.id);

  return app.save(collection_MediaClips_revert_add_type);
});
