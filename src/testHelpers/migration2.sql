CREATE TABLE ${schema~}.task (
  id serial PRIMARY KEY,
  todo_id int NOT NULL REFERENCES ${schema~}.todo(id),
  name text NOT NULL,
  completed bool DEFAULT FALSE
);
