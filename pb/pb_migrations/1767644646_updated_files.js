/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Files_add_UploadRef = app.findCollectionByNameOrId("Files");

  collection_Files_add_UploadRef.fields.add(new RelationField({
    name: "UploadRef",
    required: false,
    collectionId: app.findCollectionByNameOrId("Uploads").id,
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_Files_add_UploadRef);

  const collection_Files_modify_name = app.findCollectionByNameOrId("Files");
  const collection_Files_modify_name_field = collection_Files_modify_name.fields.getByName("name");

  collection_Files_modify_name_field.min = null;
  collection_Files_modify_name_field.max = null;

  app.save(collection_Files_modify_name);

  const collection_Files_modify_size = app.findCollectionByNameOrId("Files");
  const collection_Files_modify_size_field = collection_Files_modify_size.fields.getByName("size");

  collection_Files_modify_size_field.min = null;

  app.save(collection_Files_modify_size);

  const collection_Files_modify_fileSource = app.findCollectionByNameOrId("Files");
  const collection_Files_modify_fileSource_field = collection_Files_modify_fileSource.fields.getByName("fileSource");

  collection_Files_modify_fileSource_field.values = ["s3", "pocketbase", "gcs"];

  return app.save(collection_Files_modify_fileSource);
}, (app) => {
  const collection_Files_revert_name = app.findCollectionByNameOrId("Files");
  const collection_Files_revert_name_field = collection_Files_revert_name.fields.getByName("name");

  collection_Files_revert_name_field.min = 1;
  collection_Files_revert_name_field.max = 255;

  app.save(collection_Files_revert_name);

  const collection_Files_revert_size = app.findCollectionByNameOrId("Files");
  const collection_Files_revert_size_field = collection_Files_revert_size.fields.getByName("size");

  collection_Files_revert_size_field.min = 0;

  app.save(collection_Files_revert_size);

  const collection_Files_revert_fileSource = app.findCollectionByNameOrId("Files");
  const collection_Files_revert_fileSource_field = collection_Files_revert_fileSource.fields.getByName("fileSource");

  collection_Files_revert_fileSource_field.values = ["s3", "pocketbase"];

  app.save(collection_Files_revert_fileSource);

  const collection_Files_revert_add_UploadRef = app.findCollectionByNameOrId("Files");
  const collection_Files_revert_add_UploadRef_field = collection_Files_revert_add_UploadRef.fields.getByName("UploadRef");

  collection_Files_revert_add_UploadRef.fields.removeById(collection_Files_revert_add_UploadRef_field.id);

  return app.save(collection_Files_revert_add_UploadRef);
});
