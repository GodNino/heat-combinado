import {test} from 'node:test';
import assert from 'node:assert/strict';
import {learningStatus, summarizeLearning} from '../lib/learning.ts';

test('completion, accuracy and review answer separate questions', () => {
 const items=Array.from({length:10},(_,i)=>({id:String(i)}));
 const scores=[{menu_item_id:'0',correct:1,total:1},{menu_item_id:'1',correct:9,total:9}];
 const summary=summarizeLearning(items,scores);
 assert.equal(summary.completion,20);assert.equal(summary.accuracy,100);assert.equal(summary.pending,8);
 assert.equal(summarizeLearning(items,[]).accuracy,null);
 assert.equal(summarizeLearning([],scores).completed,0);
 const mixed=summarizeLearning(items,[scores[0],{...scores[1],correct:4,needs_review:true}]);
 assert.equal(mixed.accuracy,50,'weights answers, not percentages of unequal-length quizzes');
 assert.equal(mixed.completed,2);assert.equal(mixed.review,1);assert.equal(mixed.atTarget,1);
 assert.equal(learningStatus(undefined),'Not completed');
 assert.equal(learningStatus({...scores[0],correct:0}),'Needs practice');
 assert.equal(learningStatus(scores[0]),'At target');
 assert.equal(learningStatus({...scores[0],needs_review:true}),'Updated - review needed');
 assert.equal(learningStatus({menu_item_id:'0',correct:79,total:99}),'Needs practice','rounded 80% must not count as passing');
});
