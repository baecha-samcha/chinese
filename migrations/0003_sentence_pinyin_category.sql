-- Sentences join the shared meaning/hanzi/pinyin quiz, so they need their own
-- pinyin, plus a category for grouping (e.g. 자기소개). Empty = unknown.
ALTER TABLE sentences ADD COLUMN pinyin TEXT NOT NULL DEFAULT '';
ALTER TABLE sentences ADD COLUMN category TEXT NOT NULL DEFAULT '';

-- 자기소개 expressions: reuse an existing row with the same Chinese text
-- (production already has all six) and only create the ones that are missing.
INSERT INTO sentences (korean, chinese, tokens, pinyin, category)
SELECT '제 소개 좀 할게요.', '我来自我介绍一下。', '["我","来","自我","介绍","一下"]', 'Wǒ lái zìwǒ jièshào yíxià.', '자기소개'
WHERE NOT EXISTS (SELECT 1 FROM sentences WHERE chinese = '我来自我介绍一下。');
INSERT INTO sentences (korean, chinese, tokens, pinyin, category)
SELECT '제가 소개해 드릴게요.', '我给你介绍一下。', '["我","给","你","介绍","一下"]', 'Wǒ gěinǐ jièshào yíxià.', '자기소개'
WHERE NOT EXISTS (SELECT 1 FROM sentences WHERE chinese = '我给你介绍一下。');
INSERT INTO sentences (korean, chinese, tokens, pinyin, category)
SELECT '만나서 기뻐요.', '见到你很高兴。', '["见到","你","很","高兴"]', 'Jiàndào nǐ hěn gāoxìng.', '자기소개'
WHERE NOT EXISTS (SELECT 1 FROM sentences WHERE chinese = '见到你很高兴。');
INSERT INTO sentences (korean, chinese, tokens, pinyin, category)
SELECT '알게 되어 영광입니다.', '认识你很荣幸。', '["认识","你","很","荣幸"]', 'Rènshi nǐ hěn róngxìng.', '자기소개'
WHERE NOT EXISTS (SELECT 1 FROM sentences WHERE chinese = '认识你很荣幸。');
INSERT INTO sentences (korean, chinese, tokens, pinyin, category)
SELECT '예전부터 존함을 들었습니다.', '久仰久仰！', '["久仰","久仰"]', 'Jiǔyǎng jiǔyǎng!', '자기소개'
WHERE NOT EXISTS (SELECT 1 FROM sentences WHERE chinese = '久仰久仰！');
INSERT INTO sentences (korean, chinese, tokens, pinyin, category)
SELECT '처음 뵙겠습니다.', '初次见面！', '["初次","见面"]', 'Chūcì jiànmiàn.', '자기소개'
WHERE NOT EXISTS (SELECT 1 FROM sentences WHERE chinese = '初次见面！');

UPDATE sentences SET category = '자기소개'
WHERE chinese IN ('我来自我介绍一下。', '我给你介绍一下。', '见到你很高兴。', '认识你很荣幸。', '久仰久仰！', '初次见面！')
  AND category = '';
UPDATE sentences SET pinyin = CASE chinese
  WHEN '我来自我介绍一下。' THEN 'Wǒ lái zìwǒ jièshào yíxià.'
  WHEN '我给你介绍一下。' THEN 'Wǒ gěinǐ jièshào yíxià.'
  WHEN '见到你很高兴。' THEN 'Jiàndào nǐ hěn gāoxìng.'
  WHEN '认识你很荣幸。' THEN 'Rènshi nǐ hěn róngxìng.'
  WHEN '久仰久仰！' THEN 'Jiǔyǎng jiǔyǎng!'
  WHEN '初次见面！' THEN 'Chūcì jiànmiàn.'
END
WHERE chinese IN ('我来自我介绍一下。', '我给你介绍一下。', '见到你很高兴。', '认识你很荣幸。', '久仰久仰！', '初次见面！')
  AND pinyin = '';
