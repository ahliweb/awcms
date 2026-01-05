import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Save, X, AlertTriangle } from 'lucide-react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * FormWrapper - Standardized form wrapper for admin editors.
 * Provides validation display, sticky submit bar, and unsaved changes warning.
 * 
 * @param {React.ReactNode} children - Form content
 * @param {function} onSubmit - Submit handler
 * @param {function} onCancel - Cancel/close handler
 * @param {boolean} isSubmitting - Submission in progress
 * @param {boolean} isDirty - Form has unsaved changes
 * @param {Array} errors - Array of error messages
 * @param {string} submitLabel - Submit button label
 * @param {string} cancelLabel - Cancel button label
 * @param {boolean} showStickyBar - Show sticky submit bar at bottom
 */
const FormWrapper = ({
    children,
    onSubmit,
    onCancel,
    isSubmitting = false,
    isDirty = false,
    errors = [],
    submitLabel = 'Save',
    cancelLabel = 'Cancel',
    showStickyBar = true,
}) => {
    const [showExitWarning, setShowExitWarning] = useState(false);

    // Warn on browser navigation if dirty
    useEffect(() => {
        const handleBeforeUnload = (e) => {
            if (isDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isDirty]);

    const handleCancel = () => {
        if (isDirty) {
            setShowExitWarning(true);
        } else {
            onCancel?.();
        }
    };

    const confirmExit = () => {
        setShowExitWarning(false);
        onCancel?.();
    };

    return (
        <div className="relative">
            {/* Validation Errors Display */}
            {errors.length > 0 && (
                <div
                    className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4"
                    role="alert"
                    aria-live="polite"
                >
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                        <div>
                            <h4 className="font-medium text-red-800">Please fix the following errors:</h4>
                            <ul className="mt-2 text-sm text-red-700 list-disc list-inside space-y-1">
                                {errors.map((error, index) => (
                                    <li key={index}>{error}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {/* Form Content */}
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    onSubmit?.();
                }}
                className={showStickyBar ? 'pb-20' : ''}
            >
                {children}

                {/* Sticky Submit Bar */}
                {showStickyBar && (
                    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg p-4 z-40">
                        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2 text-sm text-slate-500">
                                {isDirty && (
                                    <>
                                        <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                                        Unsaved changes
                                    </>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleCancel}
                                    disabled={isSubmitting}
                                >
                                    <X className="w-4 h-4 mr-2" aria-hidden="true" />
                                    {cancelLabel}
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                                >
                                    <Save className="w-4 h-4 mr-2" aria-hidden="true" />
                                    {isSubmitting ? 'Saving...' : submitLabel}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </form>

            {/* Unsaved Changes Warning Dialog */}
            <AlertDialog open={showExitWarning} onOpenChange={setShowExitWarning}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-amber-500" />
                            Unsaved Changes
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            You have unsaved changes. Are you sure you want to leave? Your changes will be lost.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Continue Editing</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmExit} className="bg-red-600 hover:bg-red-700">
                            Discard Changes
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default FormWrapper;
