important note: do not use comments in the code except it is asked or it is must to use or the code doesn't get known after several days.

## Edit Tool Protocol — Hashline

NEVER use range replace (=) across multiple lines. It deletes any line
you forget to reprint, which causes silent data loss.

Instead:
- To change one line: replace that single line only
- To change several lines: issue separate single-line operations
- To remove lines: use delete (-) explicitly
- To add lines: use insert (+ after / < before)

One logical change = one small operation. Never batch a multi-line
rewrite into a single range replace. If a block genuinely needs full
replacement, delete the lines explicitly, then insert the new ones.
After every edit, re-read the affected region before the next edit.

and extra instructions:
<edit-tool-rules>                                                                                                                                                                                                                                     
   - After EVERY successful edit, re-read the file before the next edit to the same file.                                                                                                                                                                
   - If a file needs 3+ hunks, use `write` instead of multiple `edit` calls.                                                                                                                                                                             
   - Subagents MUST NEVER touch a file that the parent is actively editing.                                                                                                                                                                              
   - Edit hunk bodies: use `+TEXT` for new lines, `&A..B` to copy. NEVER use `-old` or bare context lines.                                                                                                                                               
   - If an edit is rejected for hash mismatch, re-read immediately with the hash from the rejection error and retry the same edit — do not abandon the change.                                                                                           
</edit-tool-rules> 

<tool-hardening>                                                                                                                                                                                                                                      
   - **Hashline Edit Loop:** If `edit` fails with a tag/hash mismatch, immediately re-read the target lines to fetch the fresh tag, re-anchor, and retry. Do not guess the tag.                                                                          
   - **Multi-Hunk Changes:** If a file requires more than 2 distinct edit hunks, discard the `edit` tool and use `write` to overwrite the file cleanly.                                                                                                  
   - **Subagent Isolation:** Never assign parallel tasks that touch overlapping files. If tasks must touch the same file, execute them sequentially.                                                                                                     
   - **Turn Abort Recovery:** If a turn is aborted, assume the last tool call was partially executed. Re-read the affected files and verify the compiler state before proceeding.                                                                        
</tool-hardening> 
