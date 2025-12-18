'use client';

import { useState, useRef, useEffect } from 'react';

interface Task {
  id: string;
  text: string;
  createdAt: string;
  completed: boolean;
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('tasks');
      if (stored) {
        setTasks(JSON.parse(stored));
      }
    } catch {
      // Silently fail if localStorage is unavailable or corrupt
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('tasks', JSON.stringify(tasks));
    } catch {
      // Silently fail if localStorage is unavailable
    }
  }, [tasks]);

  const handleAddTask = () => {
    if (input.trim() === '') return;

    const newTask: Task = {
      id: Date.now().toString(),
      text: input.trim(),
      createdAt: new Date().toISOString(),
      completed: false,
    };

    setTasks([newTask, ...tasks]);
    setInput('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddTask();
    } else if (e.key === 'Backspace' && input === '') {
      const incompleteTask = tasks.find((task) => !task.completed);
      if (incompleteTask) {
        setInput(incompleteTask.text);
        setTasks(tasks.filter((task) => task.id !== incompleteTask.id));
      }
    }
  };

  const toggleTask = (id: string) => {
    setTasks(
      tasks.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task
      )
    );
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <div className="max-w-3xl mx-auto">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What needs to be done?"
          className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-6 py-4 text-xl focus:outline-none focus:border-neutral-700 placeholder:text-neutral-600 transition-colors"
        />

        <div className="mt-8 space-y-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              onClick={() => toggleTask(task.id)}
              className={`bg-neutral-900 border border-neutral-800 rounded-lg px-6 py-4 cursor-pointer hover:border-neutral-700 transition-all ${
                task.completed
                  ? 'opacity-40 hover:opacity-60'
                  : 'hover:bg-neutral-900/80'
              }`}
            >
              <span
                className={`text-lg ${
                  task.completed ? 'line-through text-neutral-500' : ''
                }`}
              >
                {task.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
