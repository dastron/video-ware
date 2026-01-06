/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Media_add_thumbnailFileRef = app.findCollectionByNameOrId("Media");

  collection_Media_add_thumbnailFileRef.fields.add(new RelationField({
    name: "thumbnailFileRef",
    required: false,
    collectionId: app.findCollectionByNameOrId("Files").id,
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_Media_add_thumbnailFileRef);

  const collection_Media_add_spriteFileRef = app.findCollectionByNameOrId("Media");

  collection_Media_add_spriteFileRef.fields.add(new RelationField({
    name: "spriteFileRef",
    required: false,
    collectionId: app.findCollectionByNameOrId("Files").id,
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_Media_add_spriteFileRef);

  const collection_Media_add_proxyFileRef = app.findCollectionByNameOrId("Media");

  collection_Media_add_proxyFileRef.fields.add(new RelationField({
    name: "proxyFileRef",
    required: false,
    collectionId: app.findCollectionByNameOrId("Files").id,
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_Media_add_proxyFileRef);

  const collection_Media_add_version = app.findCollectionByNameOrId("Media");

  collection_Media_add_version.fields.add(new NumberField({
    name: "version",
    required: false
  }));

  app.save(collection_Media_add_version);

  const collection_Media_modify_duration = app.findCollectionByNameOrId("Media");
  const collection_Media_modify_duration_field = collection_Media_modify_duration.fields.getByName("duration");

  collection_Media_modify_duration_field.min = null;

  app.save(collection_Media_modify_duration);

  const collection_Media_remove_thumbnailFile = app.findCollectionByNameOrId("Media");
  const collection_Media_remove_thumbnailFile_field = collection_Media_remove_thumbnailFile.fields.getByName("thumbnailFile");

  collection_Media_remove_thumbnailFile.fields.removeById(collection_Media_remove_thumbnailFile_field.id);

  app.save(collection_Media_remove_thumbnailFile);

  const collection_Media_remove_spriteFile = app.findCollectionByNameOrId("Media");
  const collection_Media_remove_spriteFile_field = collection_Media_remove_spriteFile.fields.getByName("spriteFile");

  collection_Media_remove_spriteFile.fields.removeById(collection_Media_remove_spriteFile_field.id);

  app.save(collection_Media_remove_spriteFile);

  const collection_Media_remove_processingVersion = app.findCollectionByNameOrId("Media");
  const collection_Media_remove_processingVersion_field = collection_Media_remove_processingVersion.fields.getByName("processingVersion");

  collection_Media_remove_processingVersion.fields.removeById(collection_Media_remove_processingVersion_field.id);

  return app.save(collection_Media_remove_processingVersion);
}, (app) => {
  const collection_Media_restore_thumbnailFile = app.findCollectionByNameOrId("Media");

  collection_Media_restore_thumbnailFile.fields.add(new TextField({
    name: "thumbnailFile",
    required: false
  }));

  app.save(collection_Media_restore_thumbnailFile);

  const collection_Media_restore_spriteFile = app.findCollectionByNameOrId("Media");

  collection_Media_restore_spriteFile.fields.add(new TextField({
    name: "spriteFile",
    required: false
  }));

  app.save(collection_Media_restore_spriteFile);

  const collection_Media_restore_processingVersion = app.findCollectionByNameOrId("Media");

  collection_Media_restore_processingVersion.fields.add(new NumberField({
    name: "processingVersion",
    required: false
  }));

  app.save(collection_Media_restore_processingVersion);

  const collection_Media_revert_duration = app.findCollectionByNameOrId("Media");
  const collection_Media_revert_duration_field = collection_Media_revert_duration.fields.getByName("duration");

  collection_Media_revert_duration_field.min = 0;

  app.save(collection_Media_revert_duration);

  const collection_Media_revert_add_thumbnailFileRef = app.findCollectionByNameOrId("Media");
  const collection_Media_revert_add_thumbnailFileRef_field = collection_Media_revert_add_thumbnailFileRef.fields.getByName("thumbnailFileRef");

  collection_Media_revert_add_thumbnailFileRef.fields.removeById(collection_Media_revert_add_thumbnailFileRef_field.id);

  app.save(collection_Media_revert_add_thumbnailFileRef);

  const collection_Media_revert_add_spriteFileRef = app.findCollectionByNameOrId("Media");
  const collection_Media_revert_add_spriteFileRef_field = collection_Media_revert_add_spriteFileRef.fields.getByName("spriteFileRef");

  collection_Media_revert_add_spriteFileRef.fields.removeById(collection_Media_revert_add_spriteFileRef_field.id);

  app.save(collection_Media_revert_add_spriteFileRef);

  const collection_Media_revert_add_proxyFileRef = app.findCollectionByNameOrId("Media");
  const collection_Media_revert_add_proxyFileRef_field = collection_Media_revert_add_proxyFileRef.fields.getByName("proxyFileRef");

  collection_Media_revert_add_proxyFileRef.fields.removeById(collection_Media_revert_add_proxyFileRef_field.id);

   app.save(collection_Media_revert_add_proxyFileRef);

  const collection_Media_revert_add_version = app.findCollectionByNameOrId("Media");
  const collection_Media_revert_add_version_field = collection_Media_revert_add_version.fields.getByName("version");

  collection_Media_revert_add_version.fields.removeById(collection_Media_revert_add_version_field.id);

   return app.save(collection_Media_revert_add_version);
});
