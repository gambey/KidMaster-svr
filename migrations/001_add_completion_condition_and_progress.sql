-- 事项完成条件：todo_item_dict 增加完成类型与目标
-- completion_type: 1=一次即完成, 2=按次数完成, 3=按时长完成
-- completion_target: 类型2时为目标次数，类型3时为目标时长（配合 completion_unit）
-- completion_unit: 仅类型3使用，'minute' | 'second'，缺省为分钟
ALTER TABLE todo_item_dict
  ADD COLUMN completion_type TINYINT NOT NULL DEFAULT 1 COMMENT '1=一次即完成 2=按次数 3=按时长',
  ADD COLUMN completion_target INT NULL COMMENT '目标值：次数或时长数值',
  ADD COLUMN completion_unit VARCHAR(10) NULL COMMENT '时长单位：minute/second，仅类型3使用';

-- 打卡进度：todo_checkin_record 增加进度字段（方案A：扩展本表）
ALTER TABLE todo_checkin_record
  ADD COLUMN progress_count INT NOT NULL DEFAULT 0 COMMENT '当前完成次数，用于 completion_type=2',
  ADD COLUMN progress_duration_minutes INT NOT NULL DEFAULT 0 COMMENT '当前累计时长(分钟)，用于 completion_type=3';
