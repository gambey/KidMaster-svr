const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// 批量提交待办事项列表
router.post('/', authenticate, async (req, res) => {
  const { todos, todo_date } = req.body || {};

  // 验证必填字段
  if (!todos || !Array.isArray(todos) || todos.length === 0) {
    return res.status(400).json({ message: 'todos array is required and cannot be empty' });
  }

  if (!todo_date) {
    return res.status(400).json({ message: 'todo_date is required (format: YYYY-MM-DD)' });
  }

  // 验证日期格式
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(todo_date)) {
    return res.status(400).json({ message: 'todo_date format must be YYYY-MM-DD' });
  }

  try {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      const insertedIds = [];
      const errors = [];

      for (let i = 0; i < todos.length; i++) {
        const todo = todos[i];
        const { item_id, child_id, is_mandatory, remark } = todo;

        // 验证必填字段
        if (!item_id) {
          errors.push({ index: i, error: 'item_id is required' });
          continue;
        }

        // 验证item_id是否存在且有效
        const [itemRows] = await connection.execute(
          'SELECT id, item_type, status FROM todo_item_dict WHERE id = ? AND status = 1 LIMIT 1',
          [item_id]
        );

        if (!itemRows.length) {
          errors.push({ index: i, error: `item_id ${item_id} not found or disabled` });
          continue;
        }

        const item = itemRows[0];

        // 如果是孩子事项，必须提供child_id
        if (item.item_type === 1 && !child_id) {
          errors.push({ index: i, error: 'child_id is required for child items (item_type=1)' });
          continue;
        }

        // 如果是家长事项，child_id应该为null
        if (item.item_type === 2 && child_id) {
          errors.push({ index: i, error: 'child_id should be null for parent items (item_type=2)' });
          continue;
        }

        // 如果提供了child_id，验证孩子是否属于当前用户
        if (child_id) {
          const [childRows] = await connection.execute(
            'SELECT id FROM parent_child_relation WHERE parent_id = ? AND child_id = ? AND status = 1 LIMIT 1',
            [req.user.id, child_id]
          );

          if (!childRows.length) {
            errors.push({ index: i, error: `child_id ${child_id} not found or access denied` });
            continue;
          }
        }

        // 检查是否已存在相同的待办（同一用户、同一孩子、同一日期、同一事项）
        const [existing] = await connection.execute(
          'SELECT id FROM daily_todo_plan WHERE user_id = ? AND child_id <=> ? AND item_id = ? AND todo_date = ? AND status = 1 LIMIT 1',
          [req.user.id, child_id || null, item_id, todo_date]
        );

        if (existing.length > 0) {
          // 如果已存在，跳过或更新（这里选择跳过，避免重复）
          continue;
        }

        // 插入待办事项
        const [result] = await connection.execute(
          `INSERT INTO daily_todo_plan 
           (user_id, child_id, item_id, todo_date, is_mandatory, remark, status) 
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [
            req.user.id,
            child_id || null,
            item_id,
            todo_date,
            is_mandatory ? 1 : 0,
            remark || null
          ]
        );

        const todoId = result.insertId;
        insertedIds.push(todoId);

        // 同步创建打卡记录（一对一关联，初始状态为未完成，进度为 0）
        await connection.execute(
          `INSERT INTO todo_checkin_record 
           (daily_todo_id, checkin_user_id, is_completed, progress_count, progress_duration_minutes) 
           VALUES (?, ?, 0, 0, 0)`,
          [todoId, req.user.id]
        );
      }

      if (errors.length > 0 && insertedIds.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          message: 'All todos failed validation',
          errors
        });
      }

      await connection.commit();
      connection.release();

      return res.status(201).json({
        message: 'Todos created successfully',
        data: {
          inserted_count: insertedIds.length,
          skipped_count: todos.length - insertedIds.length - errors.length,
          error_count: errors.length,
          errors: errors.length > 0 ? errors : undefined
        }
      });
    } catch (err) {
      await connection.rollback();
      connection.release();
      throw err;
    }
  } catch (err) {
    console.error('Create daily todos error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 查询待办事项列表
router.get('/', authenticate, async (req, res) => {
  try {
    const { todo_date, child_id, item_type, status, start_date, end_date } = req.query;

    let query = `
      SELECT 
        dtp.id,
        dtp.user_id,
        dtp.child_id,
        dtp.item_id,
        dtp.todo_date,
        dtp.is_mandatory,
        dtp.remark,
        dtp.status,
        dtp.create_time,
        dtp.update_time,
        tid.item_name,
        tid.item_type,
        tid.item_category,
        tid.path_url,
        tid.completion_type,
        tid.completion_target,
        tid.completion_unit,
        ci.child_name,
        COALESCE(cr.is_completed, 0) AS is_completed,
        cr.checkin_time,
        COALESCE(cr.progress_count, 0) AS progress_count,
        COALESCE(cr.progress_duration_minutes, 0) AS progress_duration_minutes
      FROM daily_todo_plan dtp
      INNER JOIN todo_item_dict tid ON dtp.item_id = tid.id
      LEFT JOIN child_info ci ON dtp.child_id = ci.id
      LEFT JOIN todo_checkin_record cr ON cr.daily_todo_id = dtp.id
      WHERE dtp.user_id = ?
    `;
    const params = [req.user.id];

    // 筛选条件
    if (todo_date) {
      query += ' AND dtp.todo_date = ?';
      params.push(todo_date);
    } else if (start_date && end_date) {
      query += ' AND dtp.todo_date >= ? AND dtp.todo_date <= ?';
      params.push(start_date, end_date);
    } else if (start_date) {
      query += ' AND dtp.todo_date >= ?';
      params.push(start_date);
    } else if (end_date) {
      query += ' AND dtp.todo_date <= ?';
      params.push(end_date);
    } else {
      // 默认返回今天的待办
      const today = new Date().toISOString().split('T')[0];
      query += ' AND dtp.todo_date = ?';
      params.push(today);
    }

    if (child_id !== undefined) {
      if (child_id === null || child_id === 'null' || child_id === '') {
        // 查询家长事项（child_id为null）
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

    if (status !== undefined) {
      query += ' AND dtp.status = ?';
      params.push(Number(status));
    } else {
      // 默认只返回有效的待办
      query += ' AND dtp.status = 1';
    }

    query += ' ORDER BY dtp.todo_date DESC, dtp.create_time DESC';

    const [rows] = await db.execute(query, params);

    return res.json({
      message: 'Success',
      data: rows
    });
  } catch (err) {
    console.error('Get daily todos error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 获取单个待办详情
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.execute(
      `SELECT 
        dtp.id,
        dtp.user_id,
        dtp.child_id,
        dtp.item_id,
        dtp.todo_date,
        dtp.is_mandatory,
        dtp.remark,
        dtp.status,
        dtp.create_time,
        dtp.update_time,
        tid.item_name,
        tid.item_type,
        tid.item_category,
        tid.path_url,
        tid.completion_type,
        tid.completion_target,
        tid.completion_unit,
        ci.child_name,
        COALESCE(cr.is_completed, 0) AS is_completed,
        cr.checkin_time,
        COALESCE(cr.progress_count, 0) AS progress_count,
        COALESCE(cr.progress_duration_minutes, 0) AS progress_duration_minutes
      FROM daily_todo_plan dtp
      INNER JOIN todo_item_dict tid ON dtp.item_id = tid.id
      LEFT JOIN child_info ci ON dtp.child_id = ci.id
      LEFT JOIN todo_checkin_record cr ON cr.daily_todo_id = dtp.id
      WHERE dtp.id = ? AND dtp.user_id = ?`,
      [id, req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Todo not found or access denied' });
    }

    return res.json({
      message: 'Success',
      data: rows[0]
    });
  } catch (err) {
    console.error('Get daily todo error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 更新待办事项
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { is_mandatory, remark, status } = req.body || {};

  try {
    // 验证待办是否存在且属于当前用户
    const [existing] = await db.execute(
      'SELECT * FROM daily_todo_plan WHERE id = ? AND user_id = ? LIMIT 1',
      [id, req.user.id]
    );

    if (!existing.length) {
      return res.status(404).json({ message: 'Todo not found or access denied' });
    }

    // 构建更新字段
    const updates = [];
    const values = [];

    if (is_mandatory !== undefined) {
      updates.push('is_mandatory = ?');
      values.push(is_mandatory ? 1 : 0);
    }

    if (remark !== undefined) {
      updates.push('remark = ?');
      values.push(remark || null);
    }

    if (status !== undefined) {
      updates.push('status = ?');
      values.push(Number(status));
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(id);

    await db.execute(
      `UPDATE daily_todo_plan SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    // 返回更新后的数据
    const [rows] = await db.execute(
      `SELECT 
        dtp.*,
        tid.item_name,
        tid.item_type,
        tid.item_category,
        tid.path_url,
        tid.completion_type,
        tid.completion_target,
        tid.completion_unit,
        ci.child_name,
        COALESCE(cr.is_completed, 0) AS is_completed,
        cr.checkin_time,
        COALESCE(cr.progress_count, 0) AS progress_count,
        COALESCE(cr.progress_duration_minutes, 0) AS progress_duration_minutes
      FROM daily_todo_plan dtp
      INNER JOIN todo_item_dict tid ON dtp.item_id = tid.id
      LEFT JOIN child_info ci ON dtp.child_id = ci.id
      LEFT JOIN todo_checkin_record cr ON cr.daily_todo_id = dtp.id
      WHERE dtp.id = ?`,
      [id]
    );

    return res.json({
      message: 'Todo updated successfully',
      data: rows[0]
    });
  } catch (err) {
    console.error('Update daily todo error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 删除待办事项（软删除：将status设为0）
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    // 验证待办是否存在且属于当前用户
    const [existing] = await db.execute(
      'SELECT * FROM daily_todo_plan WHERE id = ? AND user_id = ? LIMIT 1',
      [id, req.user.id]
    );

    if (!existing.length) {
      return res.status(404).json({ message: 'Todo not found or access denied' });
    }

    // 软删除：将status设为0
    await db.execute(
      'UPDATE daily_todo_plan SET status = 0 WHERE id = ?',
      [id]
    );

    return res.json({
      message: 'Todo deleted successfully'
    });
  } catch (err) {
    console.error('Delete daily todo error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

