PRAGMA foreign_keys = ON;
CREATE TABLE vocabulary (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 simplified TEXT NOT NULL, traditional TEXT NOT NULL DEFAULT '',
 pinyin TEXT NOT NULL, pinyin_normalized TEXT NOT NULL,
 meaning TEXT NOT NULL, korean_hanja_reading TEXT NOT NULL DEFAULT '',
 characters TEXT NOT NULL CHECK(json_valid(characters)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX vocabulary_identity ON vocabulary(simplified,pinyin,meaning);
CREATE INDEX vocabulary_pinyin ON vocabulary(pinyin_normalized);
CREATE TABLE characters (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, char TEXT NOT NULL, traditional TEXT NOT NULL DEFAULT '',
 decomposition TEXT CHECK(decomposition IS NULL OR json_valid(decomposition)),
 UNIQUE(vocabulary_id,position)
);
CREATE TABLE components (
 value TEXT PRIMARY KEY,
 stroke_count INTEGER,
 shape_group TEXT,
 CHECK(stroke_count IS NULL OR stroke_count BETWEEN 1 AND 64)
);
CREATE TABLE character_components (
 character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
 component_value TEXT NOT NULL REFERENCES components(value),
 path TEXT NOT NULL, position TEXT NOT NULL,
 PRIMARY KEY(character_id,path)
);
CREATE TABLE sentences (
 id INTEGER PRIMARY KEY AUTOINCREMENT, korean TEXT NOT NULL, chinese TEXT NOT NULL,
 tokens TEXT NOT NULL CHECK(json_valid(tokens)), explanation TEXT NOT NULL DEFAULT ''
);
CREATE TABLE grammar_rules (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, explanation TEXT NOT NULL,
 correct_examples TEXT NOT NULL CHECK(json_valid(correct_examples)),
 wrong_examples TEXT NOT NULL CHECK(json_valid(wrong_examples)),
 tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags)),
 questions TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(questions))
);
CREATE TABLE culture_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, question TEXT NOT NULL,
 answer TEXT NOT NULL, distractors TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(distractors)),
 explanation TEXT NOT NULL DEFAULT ''
);
-- Triggers keep derived character/component records consistent on every write, including bulk import.
CREATE TRIGGER vocabulary_insert AFTER INSERT ON vocabulary BEGIN
 INSERT INTO characters(vocabulary_id,position,char,traditional,decomposition)
 SELECT NEW.id,CAST(key AS INTEGER),json_extract(value,'$.char'),coalesce(json_extract(value,'$.traditional'),''),json_extract(value,'$.decomposition') FROM json_each(NEW.characters);
END;
CREATE TRIGGER vocabulary_update AFTER UPDATE OF characters ON vocabulary BEGIN
 DELETE FROM characters WHERE vocabulary_id=NEW.id;
 INSERT INTO characters(vocabulary_id,position,char,traditional,decomposition)
 SELECT NEW.id,CAST(key AS INTEGER),json_extract(value,'$.char'),coalesce(json_extract(value,'$.traditional'),''),json_extract(value,'$.decomposition') FROM json_each(NEW.characters);
END;
CREATE TRIGGER character_insert AFTER INSERT ON characters WHEN NEW.decomposition IS NOT NULL BEGIN
 INSERT OR IGNORE INTO components(value)
 SELECT json_extract(value,'$.value') FROM json_tree(NEW.decomposition)
 WHERE type='object' AND json_extract(value,'$.type')='character';
 INSERT INTO character_components(character_id,component_value,path,position)
 SELECT NEW.id,json_extract(value,'$.value'),fullkey,
 CASE WHEN fullkey LIKE '%children[0]' THEN 'first' WHEN fullkey LIKE '%children[1]' THEN 'second' ELSE 'other' END
 FROM json_tree(NEW.decomposition) WHERE type='object' AND json_extract(value,'$.type')='character';
END;
