-- child_info 增加家长信件内容字段
ALTER TABLE child_info
  ADD COLUMN parent_letter TEXT NULL COMMENT '家长写给孩子的信件内容';
