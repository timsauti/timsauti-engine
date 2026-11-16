-- Challenges worded as challenges: take a side and defend it, or give your top three.

update public.challenges set
  title = 'The Boarding Debate',
  question = 'Pick the best grade to start boarding a child, and defend your choice in three sentences.',
  brief = 'Grade 1? Grade 4? Grade 7? Not until high school? Choose your side, make your strongest case in three sentences and win other parents over. Read the other arguments and vote for the most convincing one. The best argument wins KSh 500 airtime.',
  rules = replace(replace(rules,
    'One answer per person, up to 500 characters (about 3 to 5 sentences).', 'One answer per person: name one grade and defend it in three sentences, up to 500 characters.'),
    'for how helpful, thoughtful and clearly written it is', 'for how convincing, practical and clearly argued it is')
where slug = '01';

update public.challenges set
  title = 'The School Checklist',
  question = 'Give parents your top three must checks before choosing a Primary and Junior School.',
  brief = 'Fees, teachers, results, food, safety, distance? Share the three things you would never skip when choosing a school, and why. Read other checklists and vote for the most useful one. The best checklist wins KSh 500 airtime.',
  rules = replace(replace(rules,
    'One answer per person, up to 500 characters (about 3 to 5 sentences).', 'One answer per person: your top three checks, up to 500 characters.'),
    'for how helpful, thoughtful and clearly written it is', 'for how useful, practical and clearly written it is')
where slug = '02';
