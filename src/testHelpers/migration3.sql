CREATE TABLE ${schema~}.assignee (
  id serial PRIMARY KEY,
  name text NOT NULL
);

ALTER TABLE ${schema~}.task
  ADD COLUMN assignee_id int REFERENCES ${schema~}.assignee(id)
;
