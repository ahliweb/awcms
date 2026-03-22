/**
 * useHistory Hook
 * Provides undo/redo functionality for state management
 */

import { useState, useCallback, useRef, useEffect } from 'react';

const MAX_HISTORY_SIZE = 50;

export function useHistory(initialState) {
    // History stack
    const [history, setHistory] = useState([initialState || { content: [], root: {} }]);
    const [currentIndex, setCurrentIndex] = useState(0);

    // Use ref to track current index for stale closures (Puck)
    const currentIndexRef = useRef(0);
    useEffect(() => {
        currentIndexRef.current = currentIndex;
    }, [currentIndex]);

    // Flag to prevent adding to history during undo/redo
    const isUndoRedo = useRef(false);

    // Current state
    const currentState = history[currentIndex];



    // Can undo/redo
    const canUndo = currentIndex > 0;
    const canRedo = currentIndex < history.length - 1;

    // Set state and add to history
    const setState = useCallback((newState) => {
        // Skip if this is an undo/redo action
        if (isUndoRedo.current) {
            isUndoRedo.current = false;
            return;
        }

        // Don't add to history if state hasn't changed
        if (JSON.stringify(newState) === JSON.stringify(history[currentIndex])) {
            return;
        }

        setHistory(prevHistory => {
            // Remove any future states if we're not at the end
            // Use ref current value to avoid stale closure issues
            const currentIdx = currentIndexRef.current;
            const newHistory = prevHistory.slice(0, currentIdx + 1);

            // Add new state
            newHistory.push(newState);

            // Trim history if it exceeds max size
            if (newHistory.length > MAX_HISTORY_SIZE) {
                return newHistory.slice(newHistory.length - MAX_HISTORY_SIZE);
            }

            return newHistory;
        });

        setCurrentIndex(prev => {
            const newIndex = prev + 1;
            return Math.min(newIndex, MAX_HISTORY_SIZE - 1);
        });
    }, [currentIndex, history]);

    // Undo
    const undo = useCallback(() => {
        if (canUndo) {
            isUndoRedo.current = true;
            setCurrentIndex(prev => prev - 1);
        }
    }, [canUndo]);

    // Redo
    const redo = useCallback(() => {
        if (canRedo) {
            isUndoRedo.current = true;
            setCurrentIndex(prev => prev + 1);
        }
    }, [canRedo]);

    // Reset history
    const resetHistory = useCallback((newInitialState) => {
        setHistory([newInitialState]);
        setCurrentIndex(0);
    }, []);

    // History info
    const historyInfo = {
        currentIndex,
        totalSteps: history.length,
        canUndo,
        canRedo
    };

    return {
        state: currentState,
        setState,
        undo,
        redo,
        canUndo,
        canRedo,
        resetHistory,
        historyInfo
    };
}
