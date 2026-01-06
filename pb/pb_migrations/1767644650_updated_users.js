/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Users_modify_name = app.findCollectionByNameOrId("Users");
  const collection_Users_modify_name_field = collection_Users_modify_name.fields.getByName("name");

  collection_Users_modify_name_field.pattern = null;

  app.save(collection_Users_modify_name);

  const collection_Users_modify_avatar = app.findCollectionByNameOrId("Users");
  const collection_Users_modify_avatar_field = collection_Users_modify_avatar.fields.getByName("avatar");

  collection_Users_modify_avatar_field.thumbs = null;

  return app.save(collection_Users_modify_avatar);
}, (app) => {
  const collection_Users_revert_name = app.findCollectionByNameOrId("Users");
  const collection_Users_revert_name_field = collection_Users_revert_name.fields.getByName("name");

  collection_Users_revert_name_field.pattern = "";

  app.save(collection_Users_revert_name);

  const collection_Users_revert_avatar = app.findCollectionByNameOrId("Users");
  const collection_Users_revert_avatar_field = collection_Users_revert_avatar.fields.getByName("avatar");

  collection_Users_revert_avatar_field.thumbs = null;

  return app.save(collection_Users_revert_avatar);
});
