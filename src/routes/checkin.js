const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// 更新打卡记录（支持家长/孩子打卡；支持按次数/按时长的进度与完成判定）
router.put('/:daily_todo_id', authenticate, async (req, res) => {
  const { daily_todo_id } = req.params;
  const { is_completed, checkin_remark, progress_count, progress_count_delta, progress_duration_minutes } = req.body || {};

  if (is_completed === undefined || is_completed === null) {
    return res.status(400).json({ message: 'is_completed is required (0 or 1)' });
  }
  if (is_completed !== 0 && is_completed !== 1) {
    return res.status(400).json({ message: 'is_completed must be 0 (not completed) or 1 (completed)' });
  }

  try {
    // 验证待办是否存在且属于当前用户，并获取事项完成条件
    const [todoRows] = await db.execute(
      `SELECT dtp.*, tid.item_type, tid.completion_type, tid.completion_target, tid.completion_unit
       FROM daily_todo_plan dtp
       INNER JOIN todo_item_dict tid ON dtp.item_id = tid.id
       WHERE dtp.id = ? AND dtp.status = 1 LIMIT 1`,
      [daily_todo_id]
    );

    if (!todoRows.length) {
      return res.status(404).json({ message: 'Daily todo not found or inactive' });
    }

    const todo = todoRows[0];

    // 验证权限：待办必须属于当前用户
    if (todo.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied: todo does not belong to you' });
    }

    // 如果是孩子事项，验证孩子是否属于当前用户
    if (todo.child_id) {
      const [relationRows] = await db.execute(
        'SELECT * FROM parent_child_relation WHERE parent_id = ? AND child_id = ? AND status = 1 LIMIT 1',
        [req.user.id, todo.child_id]
      );

      if (!relationRows.length) {
        return res.status(403).json({ message: 'Access denied: child not found or not yours' });
      }
    }

    const completionType = todo.completion_type != null ? Number(todo.completion_type) : 1;
    const completionTarget = todo.completion_target != null ? Number(todo.completion_target) : null;

    // 按次数/按时长时：用进度判定是否完成，并可更新进度
    // progress_count：覆盖为当前总值；progress_count_delta：在现有值上累加（跳绳等多次达成用）
    let effectiveCompleted = is_completed;
    const hasDelta = progress_count_delta !== undefined && progress_count_delta !== null;
    let progressCountVal = progress_count !== undefined && progress_count !== null ? Number(progress_count) : null;
    let progressDurationVal = progress_duration_minutes !== undefined && progress_duration_minutes !== null ? Number(progress_duration_minutes) : null;

    const [checkinRows] = await db.execute(
      'SELECT * FROM todo_checkin_record WHERE daily_todo_id = ? LIMIT 1',
      [daily_todo_id]
    );

    const currentCount = checkinRows.length > 0 && checkinRows[0].progress_count != null ? Number(checkinRows[0].progress_count) : 0;
    const currentDuration = checkinRows.length > 0 && checkinRows[0].progress_duration_minutes != null ? Number(checkinRows[0].progress_duration_minutes) : 0;

    if (hasDelta) {
      // 累加：新值 = 当前值 + delta，不低于 0
      const delta = Number(progress_count_delta);
      progressCountVal = Math.max(0, currentCount + delta);
    } else if (progressCountVal === null) {
      progressCountVal = currentCount;
    }
    if (progressDurationVal === null) progressDurationVal = currentDuration;

    if (completionType === 2 && completionTarget != null && progressCountVal >= completionTarget) {
      effectiveCompleted = 1;
    } else if (completionType === 3 && completionTarget != null && progressDurationVal >= completionTarget) {
      effectiveCompleted = 1;
    }

    let checkinId;
    if (checkinRows.length === 0) {
      const [result] = await db.execute(
        `INSERT INTO todo_checkin_record 
         (daily_todo_id, checkin_user_id, is_completed, checkin_time, checkin_remark, progress_count, progress_duration_minutes) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          daily_todo_id,
          req.user.id,
          effectiveCompleted,
          effectiveCompleted === 1 ? new Date() : null,
          checkin_remark || null,
          progressCountVal,
          progressDurationVal
        ]
      );
      checkinId = result.insertId;
    } else {
      checkinId = checkinRows[0].id;
      const updateFields = [];
      const updateValues = [];

      updateFields.push('is_completed = ?');
      updateValues.push(effectiveCompleted);

      if (effectiveCompleted === 1) {
        updateFields.push('checkin_time = ?');
        updateValues.push(new Date());
      } else {
        updateFields.push('checkin_time = NULL');
      }

      updateFields.push('progress_count = ?');
      updateValues.push(progressCountVal);
      updateFields.push('progress_duration_minutes = ?');
      updateValues.push(progressDurationVal);

      if (checkin_remark !== undefined) {
        updateFields.push('checkin_remark = ?');
        updateValues.push(checkin_remark || null);
      }

      updateFields.push('checkin_user_id = ?');
      updateValues.push(req.user.id);
      updateValues.push(checkinId);

      await db.execute(
        `UPDATE todo_checkin_record SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );
    }

    // 返回更新后的打卡记录
    const [updatedRows] = await db.execute(
      `SELECT 
        cr.*,
        dtp.todo_date,
        dtp.child_id,
        tid.item_name,
        tid.item_type,
        tid.completion_type,
        tid.completion_target,
        tid.completion_unit,
        ci.child_name
       FROM todo_checkin_record cr
       INNER JOIN daily_todo_plan dtp ON cr.daily_todo_id = dtp.id
       INNER JOIN todo_item_dict tid ON dtp.item_id = tid.id
       LEFT JOIN child_info ci ON dtp.child_id = ci.id
       WHERE cr.id = ?`,
      [checkinId]
    );

    return res.json({
      message: 'Check-in updated successfully',
      data: updatedRows[0]
    });
  } catch (err) {
    console.error('Update check-in error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 按日期查询打卡情况
router.get('/date/:date', authenticate, async (req, res) => {
  const { date } = req.params;
  const { child_id, item_type } = req.query;

  // 验证日期格式
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({ message: 'Date format must be YYYY-MM-DD' });
  }

  try {
    let query = `
      SELECT 
        cr.id,
        cr.daily_todo_id,
        cr.checkin_user_id,
        cr.is_completed,
        cr.checkin_time,
        cr.checkin_remark,
        cr.progress_count,
        cr.progress_duration_minutes,
        cr.create_time,
        cr.update_time,
        dtp.todo_date,
        dtp.user_id,
        dtp.child_id,
        dtp.item_id,
        dtp.is_mandatory,
        dtp.remark as todo_remark,
        tid.item_name,
        tid.item_type,
        tid.item_category,
        tid.path_url,
        tid.completion_type,
        tid.completion_target,
        tid.completion_unit,
        ci.child_name
      FROM todo_checkin_record cr
      INNER JOIN daily_todo_plan dtp ON cr.daily_todo_id = dtp.id
      INNER JOIN todo_item_dict tid ON dtp.item_id = tid.id
      LEFT JOIN child_info ci ON dtp.child_id = ci.id
      WHERE dtp.user_id = ? AND dtp.todo_date = ? AND dtp.status = 1
    `;
    const params = [req.user.id, date];

    // 筛选条件
    if (child_id !== undefined) {
      if (child_id === null || child_id === 'null' || child_id === '') {
        query += ' AND dtp.child_id IS NULL';
      } else {
        // 验证孩子是否属于当前用户
        const [childRows] = await db.execute(
          'SELECT id FROM parent_child_relation WHERE parent_id = ? AND child_id = ? AND status = 1 LIMIT 1',
          [req.user.id, child_id]
        );
        if (childRows.length === 0) {
          return res.status(403).json({ message: 'Access denied: child not found or not yours' });
        }
        query += ' AND dtp.child_id = ?';
        params.push(Number(child_id));
      }
    }

    if (item_type !== undefined) {
      query += ' AND tid.item_type = ?';
      params.push(Number(item_type));
    }

    query += ' ORDER BY tid.item_type, dtp.child_id, cr.is_completed DESC, cr.checkin_time DESC';

    const [rows] = await db.execute(query, params);

    // 统计信息
    const stats = {
      total: rows.length,
      completed: rows.filter(r => r.is_completed === 1).length,
      not_completed: rows.filter(r => r.is_completed === 0).length,
      child_items: rows.filter(r => r.item_type === 1).length,
      parent_items: rows.filter(r => r.item_type === 2).length
    };

    return res.json({
      message: 'Success',
      date,
      stats,
      data: rows
    });
  } catch (err) {
    console.error('Get check-in by date error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 月度打卡情况查询
router.get('/month/:year/:month', authenticate, async (req, res) => {
  const { year, month } = req.params;
  const { child_id, item_type } = req.query;

  // 验证年月格式
  const yearNum = parseInt(year);
  const monthNum = parseInt(month);
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
    return res.status(400).json({ message: 'Invalid year' });
  }
  if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    return res.status(400).json({ message: 'Invalid month (1-12)' });
  }

  // 计算月份的开始和结束日期
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(yearNum, monthNum, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  try {
    let query = `
      SELECT 
        cr.id,
        cr.daily_todo_id,
        cr.checkin_user_id,
        cr.is_completed,
        cr.checkin_time,
        cr.checkin_remark,
        cr.progress_count,
        cr.progress_duration_minutes,
        cr.create_time,
        cr.update_time,
        dtp.todo_date,
        dtp.user_id,
        dtp.child_id,
        dtp.item_id,
        dtp.is_mandatory,
        dtp.remark as todo_remark,
        tid.item_name,
        tid.item_type,
        tid.item_category,
        tid.path_url,
        tid.completion_type,
        tid.completion_target,
        tid.completion_unit,
        ci.child_name
      FROM todo_checkin_record cr
      INNER JOIN daily_todo_plan dtp ON cr.daily_todo_id = dtp.id
      INNER JOIN todo_item_dict tid ON dtp.item_id = tid.id
      LEFT JOIN child_info ci ON dtp.child_id = ci.id
      WHERE dtp.user_id = ? AND dtp.todo_date >= ? AND dtp.todo_date <= ? AND dtp.status = 1
    `;
    const params = [req.user.id, startDate, endDate];

    // 筛选条件
    if (child_id !== undefined) {
      if (child_id === null || child_id === 'null' || child_id === '') {
        query += ' AND dtp.child_id IS NULL';
      } else {
        // 验证孩子是否属于当前用户
        const [childRows] = await db.execute(
          'SELECT id FROM parent_child_relation WHERE parent_id = ? AND child_id = ? AND status = 1 LIMIT 1',
          [req.user.id, child_id]
        );
        if (childRows.length === 0) {
          return res.status(403).json({ message: 'Access denied: child not found or not yours' });
        }
        query += ' AND dtp.child_id = ?';
        params.push(Number(child_id));
      }
    }

    if (item_type !== undefined) {
      query += ' AND tid.item_type = ?';
      params.push(Number(item_type));
    }

    query += ' ORDER BY dtp.todo_date DESC, tid.item_type, dtp.child_id, cr.is_completed DESC';

    const [rows] = await db.execute(query, params);

    // 按日期分组统计
    const dailyStats = {};
    rows.forEach(row => {
      const date = row.todo_date.toISOString().split('T')[0];
      if (!dailyStats[date]) {
        dailyStats[date] = {
          date,
          total: 0,
          completed: 0,
          not_completed: 0,
          child_items: 0,
          parent_items: 0
        };
      }
      dailyStats[date].total++;
      if (row.is_completed === 1) {
        dailyStats[date].completed++;
      } else {
        dailyStats[date].not_completed++;
      }
      if (row.item_type === 1) {
        dailyStats[date].child_items++;
      } else {
        dailyStats[date].parent_items++;
      }
    });

    // 月度总体统计
    const monthStats = {
      year: yearNum,
      month: monthNum,
      total_days: lastDay,
      total_todos: rows.length,
      completed_todos: rows.filter(r => r.is_completed === 1).length,
      not_completed_todos: rows.filter(r => r.is_completed === 0).length,
      child_items: rows.filter(r => r.item_type === 1).length,
      parent_items: rows.filter(r => r.item_type === 2).length,
      completion_rate: rows.length > 0 
        ? ((rows.filter(r => r.is_completed === 1).length / rows.length) * 100).toFixed(2) + '%'
        : '0%'
    };

    return res.json({
      message: 'Success',
      month_stats: monthStats,
      daily_stats: Object.values(dailyStats),
      data: rows
    });
  } catch (err) {
    console.error('Get check-in by month error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 获取单个打卡记录详情
router.get('/:daily_todo_id', authenticate, async (req, res) => {
  const { daily_todo_id } = req.params;

  try {
    // 验证待办是否存在且属于当前用户
    const [todoRows] = await db.execute(
      'SELECT * FROM daily_todo_plan WHERE id = ? AND user_id = ? AND status = 1 LIMIT 1',
      [daily_todo_id, req.user.id]
    );

    if (!todoRows.length) {
      return res.status(404).json({ message: 'Daily todo not found or access denied' });
    }

    const [rows] = await db.execute(
      `SELECT 
        cr.*,
        dtp.todo_date,
        dtp.child_id,
        tid.item_name,
        tid.item_type,
        tid.item_category,
        tid.path_url,
        tid.completion_type,
        tid.completion_target,
        tid.completion_unit,
        ci.child_name
      FROM todo_checkin_record cr
      INNER JOIN daily_todo_plan dtp ON cr.daily_todo_id = dtp.id
      INNER JOIN todo_item_dict tid ON dtp.item_id = tid.id
      LEFT JOIN child_info ci ON dtp.child_id = ci.id
      WHERE cr.daily_todo_id = ?`,
      [daily_todo_id]
    );

    if (!rows.length) {
      const dt = todoRows[0];
      let itemInfo = {};
      if (dt.item_id) {
        const [itemRows] = await db.execute(
          'SELECT item_name, item_type, item_category, path_url, completion_type, completion_target, completion_unit FROM todo_item_dict WHERE id = ? AND status = 1 LIMIT 1',
          [dt.item_id]
        );
        if (itemRows.length) itemInfo = itemRows[0];
      }
      return res.json({
        message: 'Success',
        data: {
          daily_todo_id: parseInt(daily_todo_id),
          is_completed: 0,
          checkin_time: null,
          checkin_remark: null,
          progress_count: 0,
          progress_duration_minutes: 0,
          todo_date: dt.todo_date,
          child_id: dt.child_id,
          item_name: itemInfo.item_name || null,
          item_type: itemInfo.item_type ?? null,
          item_category: itemInfo.item_category || null,
          path_url: itemInfo.path_url || null,
          completion_type: itemInfo.completion_type ?? 1,
          completion_target: itemInfo.completion_target ?? null,
          completion_unit: itemInfo.completion_unit || null,
          child_name: null
        }
      });
    }

    return res.json({
      message: 'Success',
      data: rows[0]
    });
  } catch (err) {
    console.error('Get check-in error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

