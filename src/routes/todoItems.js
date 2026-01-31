const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// 查询事项字典列表（支持筛选）
router.get('/', authenticate, async (req, res) => {
  try {
    const { item_type, item_category, is_default, status, creator_id } = req.query;
    
    let query = `
      SELECT 
        id,
        item_name,
        item_type,
        item_category,
        is_default,
        creator_id,
        status,
        path_url,
        completion_type,
        completion_target,
        completion_unit,
        create_time,
        update_time
      FROM todo_item_dict
      WHERE 1=1
    `;
    const params = [];

    // 筛选条件
    if (item_type !== undefined) {
      query += ' AND item_type = ?';
      params.push(Number(item_type));
    }
    
    if (item_category !== undefined) {
      query += ' AND item_category = ?';
      params.push(item_category);
    }
    
    if (is_default !== undefined) {
      query += ' AND is_default = ?';
      params.push(Number(is_default));
    }
    
    if (status !== undefined) {
      query += ' AND status = ?';
      params.push(Number(status));
    } else {
      // 默认只返回有效的事项
      query += ' AND status = 1';
    }

    // 如果指定了creator_id，只返回该用户创建的自定义事项
    if (creator_id !== undefined) {
      query += ' AND creator_id = ?';
      params.push(Number(creator_id));
    } else {
      // 默认返回系统默认事项 + 当前用户创建的自定义事项
      query += ' AND (is_default = 1 OR creator_id = ?)';
      params.push(req.user.id);
    }

    query += ' ORDER BY is_default DESC, create_time DESC';

    const [rows] = await db.execute(query, params);

    return res.json({
      message: 'Success',
      data: rows
    });
  } catch (err) {
    console.error('Get todo items error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 获取单个事项详情
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.execute(
      `SELECT 
        id,
        item_name,
        item_type,
        item_category,
        is_default,
        creator_id,
        status,
        path_url,
        completion_type,
        completion_target,
        completion_unit,
        create_time,
        update_time
       FROM todo_item_dict 
       WHERE id = ? AND status = 1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Todo item not found' });
    }

    const item = rows[0];
    
    // 如果是用户自定义事项，验证是否为当前用户创建
    if (item.is_default === 0 && item.creator_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    return res.json({
      message: 'Success',
      data: item
    });
  } catch (err) {
    console.error('Get todo item error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 添加事项（用户自定义事项）
router.post('/', authenticate, async (req, res) => {
  const { item_name, item_type, item_category, path_url, completion_type, completion_target, completion_unit } = req.body || {};

  // 验证必填字段
  if (!item_name) {
    return res.status(400).json({ message: 'item_name is required' });
  }
  
  if (item_type === undefined || item_type === null) {
    return res.status(400).json({ message: 'item_type is required (1=孩子事项, 2=家长事项)' });
  }

  if (item_type !== 1 && item_type !== 2) {
    return res.status(400).json({ message: 'item_type must be 1 (child) or 2 (parent)' });
  }

  // 完成条件校验：completion_type 1=一次 2=次数 3=时长
  const cType = completion_type !== undefined && completion_type !== null ? Number(completion_type) : 1;
  if (cType !== 1 && cType !== 2 && cType !== 3) {
    return res.status(400).json({ message: 'completion_type must be 1 (once), 2 (count), or 3 (duration)' });
  }
  if (cType === 2 || cType === 3) {
    const target = completion_target !== undefined && completion_target !== null ? Number(completion_target) : null;
    if (target == null || target < 1) {
      return res.status(400).json({ message: 'completion_target is required and must be >= 1 when completion_type is 2 or 3' });
    }
  }

  try {
    // 检查是否已存在相同名称的事项（同一用户）
    const [existing] = await db.execute(
      'SELECT id FROM todo_item_dict WHERE item_name = ? AND creator_id = ? AND status = 1 LIMIT 1',
      [item_name, req.user.id]
    );

    if (existing.length > 0) {
      return res.status(409).json({ message: 'Todo item with this name already exists' });
    }

    // 插入用户自定义事项
    const targetVal = (cType === 2 || cType === 3) ? Number(completion_target) : null;
    const unitVal = cType === 3 && completion_unit ? String(completion_unit).toLowerCase() : null;
    const [result] = await db.execute(
      `INSERT INTO todo_item_dict 
       (item_name, item_type, item_category, path_url, is_default, creator_id, status, completion_type, completion_target, completion_unit) 
       VALUES (?, ?, ?, ?, 0, ?, 1, ?, ?, ?)`,
      [item_name, item_type, item_category || null, path_url || null, req.user.id, cType, targetVal, unitVal]
    );

    // 返回创建的事项
    const [rows] = await db.execute(
      'SELECT * FROM todo_item_dict WHERE id = ? LIMIT 1',
      [result.insertId]
    );

    return res.status(201).json({
      message: 'Todo item created successfully',
      data: rows[0]
    });
  } catch (err) {
    console.error('Create todo item error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 更新事项（仅限用户自定义事项）
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { item_name, item_type, item_category, path_url, status, completion_type, completion_target, completion_unit } = req.body || {};

  try {
    // 验证事项是否存在且属于当前用户
    const [existing] = await db.execute(
      'SELECT * FROM todo_item_dict WHERE id = ? LIMIT 1',
      [id]
    );

    if (!existing.length) {
      return res.status(404).json({ message: 'Todo item not found' });
    }

    const item = existing[0];

    // 系统默认事项不允许修改
    if (item.is_default === 1) {
      return res.status(403).json({ message: 'System default items cannot be modified' });
    }

    // 只能修改自己创建的事项
    if (item.creator_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // 构建更新字段
    const updates = [];
    const values = [];

    if (item_name !== undefined) {
      // 检查新名称是否与其他事项冲突
      const [duplicate] = await db.execute(
        'SELECT id FROM todo_item_dict WHERE item_name = ? AND creator_id = ? AND id != ? AND status = 1 LIMIT 1',
        [item_name, req.user.id, id]
      );
      if (duplicate.length > 0) {
        return res.status(409).json({ message: 'Todo item with this name already exists' });
      }
      updates.push('item_name = ?');
      values.push(item_name);
    }

    if (item_type !== undefined) {
      if (item_type !== 1 && item_type !== 2) {
        return res.status(400).json({ message: 'item_type must be 1 (child) or 2 (parent)' });
      }
      updates.push('item_type = ?');
      values.push(item_type);
    }

    if (item_category !== undefined) {
      updates.push('item_category = ?');
      values.push(item_category || null);
    }

    if (path_url !== undefined) {
      updates.push('path_url = ?');
      values.push(path_url || null);
    }

    if (status !== undefined) {
      updates.push('status = ?');
      values.push(Number(status));
    }

    if (completion_type !== undefined) {
      const cType = Number(completion_type);
      if (cType !== 1 && cType !== 2 && cType !== 3) {
        return res.status(400).json({ message: 'completion_type must be 1 (once), 2 (count), or 3 (duration)' });
      }
      updates.push('completion_type = ?');
      values.push(cType);
      if (cType === 1) {
        updates.push('completion_target = NULL');
        updates.push('completion_unit = NULL');
      }
    }
    if (completion_target !== undefined && completion_target !== null) {
      const target = Number(completion_target);
      if (target < 0) {
        return res.status(400).json({ message: 'completion_target must be >= 0' });
      }
      updates.push('completion_target = ?');
      values.push(target);
    }
    if (completion_unit !== undefined) {
      updates.push('completion_unit = ?');
      values.push(completion_unit ? String(completion_unit).toLowerCase() : null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(id);

    await db.execute(
      `UPDATE todo_item_dict SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    // 返回更新后的数据
    const [rows] = await db.execute(
      'SELECT * FROM todo_item_dict WHERE id = ? LIMIT 1',
      [id]
    );

    return res.json({
      message: 'Todo item updated successfully',
      data: rows[0]
    });
  } catch (err) {
    console.error('Update todo item error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 删除事项（软删除：将status设为0，仅限用户自定义事项）
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    // 验证事项是否存在
    const [existing] = await db.execute(
      'SELECT * FROM todo_item_dict WHERE id = ? LIMIT 1',
      [id]
    );

    if (!existing.length) {
      return res.status(404).json({ message: 'Todo item not found' });
    }

    const item = existing[0];

    // 系统默认事项不允许删除
    if (item.is_default === 1) {
      return res.status(403).json({ message: 'System default items cannot be deleted' });
    }

    // 只能删除自己创建的事项
    if (item.creator_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // 软删除：将status设为0
    await db.execute(
      'UPDATE todo_item_dict SET status = 0 WHERE id = ?',
      [id]
    );

    return res.json({
      message: 'Todo item deleted successfully'
    });
  } catch (err) {
    console.error('Delete todo item error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

