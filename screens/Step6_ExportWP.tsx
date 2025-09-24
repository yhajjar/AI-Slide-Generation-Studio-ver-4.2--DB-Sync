import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { CourseData, GeneratedSlide, ExportMode, TopicDraft, WPCourse, SlideGenState } from '../types';
import { titleFromHtml } from '../utils/topicTitle';
import Card from '../components/Card';
import Button from '../components/Button';
import { wpSearchCourses, wpStartExport, WpExportPayload } from '../n8nApi';
import { RefreshIcon } from '../components/icons/RefreshIcon';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';

// FIX: Changed to a function declaration to resolve TSX parsing ambiguity with generics.
// The original `const useDebounce = <T>(...)` syntax was being misinterpreted as a JSX tag.
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);
        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);
    return debouncedValue;
}

interface Step6Props {
    courseData: CourseData;
    generatedSlides: GeneratedSlide[];
    runId: string | null;
    conversationId: string | null;
    state: SlideGenState;
    setState: React.Dispatch<React.SetStateAction<SlideGenState>>;
    onLog: (message: string) => void;
}

const Step6_ExportWP: React.FC<Step6Props> = ({ courseData, generatedSlides, runId, conversationId, state, setState, onLog }) => {
    const [exportMode, setExportMode] = useState<ExportMode>('new');
    const [newCourseTitle, setNewCourseTitle] = useState(courseData.courseTopic || '');
    const [newCourseDesc, setNewCourseDesc] = useState('');
    
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearchQuery = useDebounce(searchQuery, 500);
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<WPCourse[]>([]);
    const [selectedCourse, setSelectedCourse] = useState<WPCourse | null>(null);

    const [lessonTitle, setLessonTitle] = useState(courseData.courseTopic || 'New Lesson');
    const [topics, setTopics] = useState<TopicDraft[]>([]);
    const [publishStatus, setPublishStatus] = useState<'draft' | 'publish'>('draft');
    
    const [error, setError] = useState<string | null>(null);

    const { isExportingWp, exportSuccessMessage } = state;
    
    useEffect(() => {
        const initialTopics = generatedSlides
            .filter(s => s.html?.trim())
            .map((s, i) => ({
                slideIndex: i,
                title: titleFromHtml(s.html, `Slide ${s.pageNumber}`),
                include: true,
                html: s.html,
            }));
        setTopics(initialTopics);
    }, [generatedSlides]);

    useEffect(() => {
        if (debouncedSearchQuery.length < 3) {
            // Only clear results for short, non-empty queries (1-2 chars).
            // Don't clear for an empty query, as we want to preserve results from a "Fetch All" action.
            if (debouncedSearchQuery.length > 0) {
                setSearchResults([]);
            }
            return;
        }
        const search = async () => {
            setIsSearching(true);
            try {
                const results = await wpSearchCourses(debouncedSearchQuery, 1, onLog);
                setSearchResults(results.items);
            } catch (err: any) {
                onLog(`[ExportWP] Error during course search: ${err.message}`);
                setError(err.message);
            } finally {
                setIsSearching(false);
            }
        };
        search();
    }, [debouncedSearchQuery, onLog]);

    const handleFetchAllCourses = useCallback(async () => {
        if (isSearching) return;
        onLog('[ExportWP] User requested to fetch all courses.');
        setIsSearching(true);
        setError(null);
        setSearchQuery(''); // Clear search query to show all results are from fetch all
        try {
            const results = await wpSearchCourses('', 1, onLog);
            setSearchResults(results.items);
            onLog(`[ExportWP] Fetched ${results.items.length} courses successfully.`);
        } catch (err: any) {
            onLog(`[ExportWP] Error fetching all courses: ${err.message}`);
            setError(err.message);
        } finally {
            setIsSearching(false);
        }
    }, [isSearching, onLog]);


    const handleTopicChange = (index: number, field: 'title' | 'include', value: string | boolean) => {
        setTopics(prev => {
            const newTopics = [...prev];
            (newTopics[index] as any)[field] = value;
            return newTopics;
        });
    };

    const handleStartExport = async () => {
        setError(null);
        setState(prev => ({...prev, isExportingWp: true, exportSuccessMessage: null}));
        onLog(`[ExportWP] User initiated WordPress export. Mode: ${exportMode}, Publish Status: ${publishStatus}.`);
    
        let coursePayload: WpExportPayload['course'];
        if (exportMode === 'new') {
            if (!newCourseTitle.trim()) {
                const msg = 'New course title cannot be empty.';
                onLog(`[ExportWP] Validation failed: ${msg}`);
                setError(msg);
                setState(prev => ({...prev, isExportingWp: false}));
                return;
            }
            coursePayload = { title: newCourseTitle, description: newCourseDesc };
        } else {
            if (!selectedCourse) {
                const msg = 'You must select an existing course.';
                 onLog(`[ExportWP] Validation failed: ${msg}`);
                setError(msg);
                 setState(prev => ({...prev, isExportingWp: false}));
                return;
            }
            coursePayload = { id: selectedCourse.id };
        }

        const includedTopics = topics
            .filter(t => t.include)
            .map(t => ({ title: t.title, html: t.html }));
        
        if (includedTopics.length === 0) {
            const msg = 'You must include at least one topic to export.';
            onLog(`[ExportWP] Validation failed: ${msg}`);
            setError(msg);
            setState(prev => ({...prev, isExportingWp: false}));
            return;
        }

        onLog('[ExportWP] Validating inputs and building payload...');
        const payload: WpExportPayload = {
            mode: exportMode,
            course: coursePayload,
            lesson: { title: lessonTitle },
            topics: includedTopics,
            publish: publishStatus,
            runId: runId,
            conversationId: conversationId,
        };
        
        try {
            const response = await wpStartExport(payload, onLog);
            onLog(`[ExportWP] Export finished successfully. Status: ${response.status}`);
            setState(prev => ({...prev, isExportingWp: false, exportSuccessMessage: response.status || "Export completed successfully."}));
        } catch (err: any) {
            onLog(`[ExportWP] Caught error from wpStartExport: ${err.message}`);
            setError(err.message);
            setState(prev => ({...prev, isExportingWp: false, exportSuccessMessage: null}));
        }
    };

    const handleBack = () => {
        setState(prev => ({...prev, step: 5, isExportingWp: false, exportSuccessMessage: null}));
    }

    return (
        <div className="flex flex-col">
            <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">Export to WordPress</h2>
            <p className="text-lg text-gray-600 mb-8 text-center">Publish your generated slides as a new course or add them to an existing one.</p>
            
            {error && <p className="text-red-600 my-4 text-center font-semibold bg-red-100 p-3 rounded-md">{error}</p>}
            
            {(isExportingWp || exportSuccessMessage) ? (
                <Card className="flex flex-col items-center justify-center text-center min-h-[300px]">
                    {isExportingWp ? (
                        <>
                            <h3 className="text-xl font-bold text-center mb-4">Export in Progress...</h3>
                            <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-[#219ebc]"></div>
                            <p className="mt-4 text-gray-600">Sending your course data to WordPress.</p>
                        </>
                    ) : (
                        <>
                            <CheckCircleIcon className="w-16 h-16 text-green-500 mb-4" />
                            <h3 className="text-xl font-bold text-center mb-2 text-green-700">Export Complete!</h3>
                            <p className="text-gray-700 bg-green-100 px-4 py-2 rounded-md">{exportSuccessMessage}</p>
                            <Button onClick={handleBack} variant="secondary" className="mt-6">
                                Back to Slides
                            </Button>
                        </>
                    )}
                </Card>
            ) : (
                <div className="space-y-6">
                    <Card>
                        <h3 className="text-xl font-bold text-[#219ebc] mb-4">A) Destination</h3>
                        <div className="flex gap-4">
                             <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="exportMode" value="new" checked={exportMode === 'new'} onChange={() => setExportMode('new')} className="w-4 h-4 text-[#219ebc] bg-gray-100 border-gray-300 focus:ring-[#219ebc]" />
                                Create new course
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="exportMode" value="existing" checked={exportMode === 'existing'} onChange={() => setExportMode('existing')} className="w-4 h-4 text-[#219ebc] bg-gray-100 border-gray-300 focus:ring-[#219ebc]" />
                                Use existing course
                            </label>
                        </div>
                        <div className="mt-4 pl-6 border-l-2 border-gray-200">
                            {exportMode === 'new' ? (
                                <div className="space-y-3">
                                    <input type="text" value={newCourseTitle} onChange={e => setNewCourseTitle(e.target.value)} placeholder="Course Title" className="w-full bg-white border border-gray-300 rounded-md py-2 px-4 text-gray-900 focus:ring-[#219ebc] focus:border-[#219ebc]" />
                                    <textarea value={newCourseDesc} onChange={e => setNewCourseDesc(e.target.value)} placeholder="Course Description (optional)" className="w-full bg-white border border-gray-300 rounded-md py-2 px-3 text-gray-900 focus:ring-[#219ebc] focus:border-[#219ebc] min-h-[80px]" />
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="text" 
                                            value={searchQuery} 
                                            onChange={e => setSearchQuery(e.target.value)} 
                                            placeholder="Search courses or fetch all..." 
                                            className="flex-grow bg-white border border-gray-300 rounded-md py-2 px-4 text-gray-900 focus:ring-[#219ebc] focus:border-[#219ebc]" 
                                        />
                                        <Button 
                                            onClick={handleFetchAllCourses} 
                                            variant="secondary" 
                                            disabled={isSearching} 
                                            className="flex-shrink-0 px-3 py-2"
                                            aria-label={isSearching && searchQuery === '' ? 'Fetching courses' : 'Fetch all courses'}
                                        >
                                            {isSearching && searchQuery === '' ? (
                                                <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-gray-700"></div>
                                            ) : (
                                                <RefreshIcon className="w-5 h-5" />
                                            )}
                                        </Button>
                                    </div>

                                    {isSearching && debouncedSearchQuery.length >= 3 && <p className="text-sm text-gray-500">Searching...</p>}
                                    
                                    {searchResults.length > 0 && (
                                        <ul className="border border-gray-200 rounded-md max-h-40 overflow-y-auto">
                                            {searchResults.map(course => (
                                                <li key={course.id} onClick={() => { setSelectedCourse(course); setSearchQuery(course.title); setSearchResults([]) }} className="p-2 cursor-pointer hover:bg-gray-100">{course.title}</li>
                                            ))}
                                        </ul>
                                    )}
                                    
                                    {selectedCourse && !searchResults.length && <p className="text-sm font-semibold text-green-600 mt-2">Selected: {selectedCourse.title}</p>}
                                </div>
                            )}
                        </div>
                    </Card>

                    <Card>
                        <h3 className="text-xl font-bold text-[#219ebc] mb-4">B) Structure & Export</h3>
                         <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Lesson Name</label>
                                <input type="text" value={lessonTitle} onChange={e => setLessonTitle(e.target.value)} className="w-full bg-white border border-gray-300 rounded-md py-2 px-4 text-gray-900 focus:ring-[#219ebc] focus:border-[#219ebc]" />
                            </div>
                             <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Topic Mapping</label>
                                <div className="space-y-2 max-h-60 overflow-y-auto p-2 border rounded-md bg-gray-50">
                                    {topics.map((topic, index) => (
                                        <div key={index} className="flex items-center gap-3">
                                            <input type="checkbox" checked={topic.include} onChange={e => handleTopicChange(index, 'include', e.target.checked)} className="w-4 h-4 text-[#219ebc] bg-gray-100 border-gray-300 rounded focus:ring-[#219ebc]" />
                                            <input type="text" value={topic.title} onChange={e => handleTopicChange(index, 'title', e.target.value)} className="flex-1 bg-white border border-gray-300 rounded-md py-1 px-2 text-sm text-gray-900 focus:ring-[#219ebc] focus:border-[#219ebc]" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Publish as</label>
                                <select value={publishStatus} onChange={e => setPublishStatus(e.target.value as 'draft' | 'publish')} className="bg-white border-gray-300 rounded-md py-2 px-3 text-sm">
                                    <option value="draft">Draft</option>
                                    <option value="publish">Publish</option>
                                </select>
                            </div>
                        </div>
                    </Card>

                    <div className="flex justify-between items-center mt-6">
                        <Button onClick={handleBack} variant="secondary" className="flex items-center gap-2">
                            <ChevronLeftIcon className="w-5 h-5"/> Back
                        </Button>
                        <Button onClick={handleStartExport} disabled={isExportingWp}>
                            {isExportingWp ? 'Exporting...' : 'Start Export'}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Step6_ExportWP;