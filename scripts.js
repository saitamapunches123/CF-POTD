// ==UserScript==
// @name         cf potd
// @namespace    http://tampermonkey.net/
// @version      2025-12-26
// @description  This Script will add A POTD link on codeforces
// @author       You
// @match        *://codeforces.com/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_log
// @grant        GM_setValue
// @grant        GM_getValue
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/560655/cf%20potd.user.js
// @updateURL https://update.greasyfork.org/scripts/560655/cf%20potd.meta.js
// ==/UserScript==




/*
  DESIGN CHOICES:

  1) To avoid API calls during contest all calls will be done only when clicking "POTD" thus making clicking POTD a bit slower but keeping refresh fast thus no lag in contest
  2) POTD are use specific that is for each user POTD will be different as POTD depend on the user curr_rating
  3) POTD will be in range [curr_rating-NEG_DELTA*100 , curr_rating+POS_DELTA*100] where curr_rating is rounded down. For example: if user is 1650 POTD can be of [1400,1500,1600,1700,1800]
     Please change neg_delta and pos_delta constant variables if you want to change distribution
  3) POTD will always be an unsolved problem Unlike Leetcode where POTD can be an already solved problem. As they follow a global POTD model but this is using a user specic POTD
  4) on solving POTD and clicking "POTD" again you will be given a new unsolved "POTD" this is done as I want the "POTD" link to work as both a POTD and a random problem Generator
*/

/*
 TODO:
  1) ADD STREAKS
  2) For logged in users remove solved problems //DONE
  3) Remove problems that are language specific (i.e doesnt support C++) //DONE
  4) Add TODO problems //DONE
  5) HOOK THIS UP TO A PROPER BACKEND so potd and todo are not saved in browser
*/
const DEBUG_MODE = "DEBUG";
const PROD_MODE = "PROD";
const MODE = PROD_MODE; // change if doing devlopment

const ADMIN_USER_NAME = "hermit_parth";
const NEG_DELTA=0,POS_DELTA=3; //Change if you want a different distribution
const CODEFORCES_URL = "https://codeforces.com";
const CODEFORCES_API_URL = `${CODEFORCES_URL}/api`;
const PROBLEM = "problem";
const PROBLEMSET = "problemset";
const CONTEST = "contest";
const ALL_PROBLEMS_ENDPOINT = `${PROBLEMSET}.problems`;
const ALL_CONTEST_ENDPOINT = `${CONTEST}.list`;
const USERS_ENDPOINT ="user.info?handles=";
const USERS_STATUS_ENDPOINT ="user.status?handle=";
const DEFAULT_USER_NAME = "Enter";
const DEFAULT_RATING = 800;
const OK_VERDICT="OK";
const BANNED_CONTEST_WORDS = [
    "Kotlin",
    "Unknown Language",
    "Testing",
    "April"
]; // To remove problem specific remove these contests
const LANG_CHOSER_SELECTOR = ".lang-chooser"; // this div containse USER_NAME and will add "POTD" here
const TAG_SELECTOR = ".tag-box";
const PROBLEM_FAVORITE_IMAGE_SELECTOR = ".toggle-favourite";
const RATING_TAG_REGEX = /^[0-9*]+$/;
const PROBLEM_PAGE_REGEX = /\/problem\//;
const POTD_TEXT = "POTD";
const TODO_TEXT = "TODO";
const TODO_DAYS_THRESHOLD = 30; // Ideally wait for 30 days before solving TODO
const ADD_TO_TODO_TEXT = "Add to TODO";
const ADD_TO_TODO_EMOJI = "➕";
const MARK_AS_DONE_TEXT = "Mark as done (remove from TODO)";
const MARK_AS_DONE_EMOJI = "✅";
const DEFAULT_GM_VALUE = -1;
const CLICK = "click";
const MS_PER_DAY = 1000 * 60 * 60 * 24;


let ALL_PROBLEMS = []; // initialized in update_ALL_PROBLEMS
let TODO_PROBLEMS = [];
let USER_NAME = DEFAULT_USER_NAME;
let CONTEST_ID_TO_CONTEST_NAME = []; // initialized in update_CONTEST_ID_TO_CONTEST_NAME
let DATE_STRING;

(async () => {
    function pick_random_element(arr){
        const random_index = Math.floor(Math.random() * arr.length);
        return arr[random_index]
    }
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    function refresh() {
        if(MODE === PROD_MODE){
            location.reload();
        }else{
            console.log("in",MODE);
        }
    }
    function load_url(url){
        if(MODE === PROD_MODE){
           window.location.href = url;
        }else{
            console.log("in",MODE);
        }
    }

    function should_recompute(value){
        return (value === DEFAULT_GM_VALUE || MODE === DEBUG_MODE);// in DEBUG_MODE recompute everytime
    }
    function GM_getValue2(key){
        return GM_getValue(key, DEFAULT_GM_VALUE);
    }
    function get_problem_favorite_image(){
        return document.querySelector(PROBLEM_FAVORITE_IMAGE_SELECTOR);
    }
    function get_date_ist() {
        const now = new Date();
        const istOffset = 5.5 * 60; // minutes
        const istTime = new Date(now.getTime() + istOffset * 60 * 1000 - now.getTimezoneOffset() * 60 * 1000);
        const year = istTime.getFullYear();
        const month = String(istTime.getMonth() + 1).padStart(2, '0');
        const day = String(istTime.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    function diff_in_days_from_today(earlierDate) {
        const todayStr = get_date_ist();
        const today = new Date(todayStr);
        const past = new Date(earlierDate);
        return (today - past) / MS_PER_DAY;
    }
    async function make_codeforces_api_call(endpoint) {
        const url=`${CODEFORCES_API_URL}/${endpoint}`;
        console.log(`making API call to ${url}`);
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error("Network response was not ok");

            const data = await response.json();
            if (data.status !== "OK") throw new Error("API returned error");

            return data.result;
        } catch (err) {
            console.error("API call failed:", endpoint, err);
            return null;
        }
    }

    async function get_all_problems(){
        const result = await make_codeforces_api_call(ALL_PROBLEMS_ENDPOINT);
        return result.problems;
    }

    async function get_all_contest(){
        return await make_codeforces_api_call(ALL_CONTEST_ENDPOINT);
    }

    async function get_user_profile() {
        const endpoint = `${USERS_ENDPOINT}${USER_NAME}`;
        try {
            const result = await make_codeforces_api_call(endpoint);
            return result[0];
        } catch (err) {
            console.error(`Error fetching profile for ${USER_NAME}:`, err);
            return null;
        }
    }

    async function get_user_status(){
        const endpoint = `${USERS_STATUS_ENDPOINT}${USER_NAME}`;
        try {
            return await make_codeforces_api_call(endpoint);
        } catch (err) {
            console.error(`Error fetching profile for ${USER_NAME}:`, err);
            return null;
        }
    }

    function get_user_name_div(){
        const lang_chooser_div = document.querySelector(LANG_CHOSER_SELECTOR);
        if (!lang_chooser_div) return;

        const user_name_div = lang_chooser_div.querySelectorAll(":scope > div")[1];
        return user_name_div;
    }

    function get_rating(rating) {
        if (!Number.isInteger(rating)) return 0;
        rating=Math.max(rating,DEFAULT_RATING);
        return Math.floor(rating / 100);
    }

    function get_problem_url(contest_id, problem_code) {
        return `${CODEFORCES_URL}/${CONTEST}/${contest_id}/${PROBLEM}/${problem_code}`;
    }

    function get_potd_problems_around_rating(rating) {
        const potd_problems = [];

        for (let delta = -NEG_DELTA; delta <= POS_DELTA; delta++) {
            const nrating = rating + delta;
            if (ALL_PROBLEMS[nrating] && ALL_PROBLEMS[nrating].length > 0) {
                potd_problems.push(...ALL_PROBLEMS[nrating]);
            }
        }
        return potd_problems;
    }

    function get_potd_GM_KEY(){
        return `${DATE_STRING}_${POTD_TEXT}_${USER_NAME}`;
    }

    function get_all_problems_GM_KEY(){
        return `${DATE_STRING}_${PROBLEMSET}`;
    }

    function get_todo_GM_KEY(){
        return `${TODO_TEXT}_${USER_NAME}`;
    }

    function is_problem_page(page_url){
        return PROBLEM_PAGE_REGEX.test(window.location.href);
    }

    async function get_solved_problems(){
        const solved = new Set();
        const user_statuses = await get_user_status();
       // console.log("user_statuses", user_statuses);
        for (const sub of user_statuses) {
            if (sub.verdict === OK_VERDICT) {
                const p = sub.problem;
                const url=get_problem_url(p.contestId, p.index);
                solved.add(url);
            }
        }
        return solved;
    }

    async function should_recompute_potd_url(value,solved_problems) {
        // If user marked previous POTD as TODO, we need a new one
        if (should_recompute(value) === true || find_from_TODO_PROBLEMS(value) !== -1) {
            console.log("Recomputing POTD: previous is TODO or should recompute");
            return true;
        }

        // Check if the user has solved the previous POTD
        if (solved_problems.has(value)) {
            console.log("Recomputing POTD: previous has been solved");
            return true;
        }

        // Otherwise, no need to recompute
        return false;
    }

    async function get_potd_url() {
        const key = get_potd_GM_KEY();
        const value = GM_getValue2(key);
        let flattened_problems;
        if(USER_NAME == DEFAULT_USER_NAME){
            if(should_recompute_potd_url(value) === false){
                return value;
            }
            flattened_problems = ALL_PROBLEMS.flat();
        }else{
            const solved_problems = await get_solved_problems();
            if(await should_recompute_potd_url(value,solved_problems)== false){
                return value;
            }
            const user_profile = await get_user_profile();
            const user_rating = get_rating(user_profile.rating);
            flattened_problems = get_potd_problems_around_rating(user_rating);
            flattened_problems = remove_solved_problems(solved_problems, flattened_problems);
        }
        if(flattened_problems.length == 0){
            flattened_problems = ALL_PROBLEMS.flat();
        }
        const potd_url = pick_random_element(flattened_problems);
        GM_setValue(key, potd_url);
        return potd_url;
    }

    function update_USER_NAME() {
        const user_name_div = get_user_name_div();
        if (!user_name_div) return DEFAULT_USER_NAME;

        const user_name_a = user_name_div.querySelector("a"); // as updating before adding TODO and POTD button
        if (!user_name_a) return DEFAULT_USER_NAME;

        USER_NAME = user_name_a.textContent.trim();
    }

    async function update_CONTEST_ID_TO_CONTEST_NAME() { //No need to cache it as will only be called by update_ALL_PROBLEMS which caches its result
        const contests = await get_all_contest();
        let max_contest_id = 0;
        for (const contest of contests) {
            max_contest_id = Math.max(max_contest_id, contest.id);
        }

        CONTEST_ID_TO_CONTEST_NAME = Array(max_contest_id + 1).fill(null);

        for (const contest of contests) {
            CONTEST_ID_TO_CONTEST_NAME[contest.id] = contest.name;
        }
    }

    function is_banned_problem(problem) {
        const contest_id = problem.contestId;

        const contest_name = CONTEST_ID_TO_CONTEST_NAME[contest_id];
        if (!contest_name){
            return false; // if null, assume allowed
        }
        for (const key of BANNED_CONTEST_WORDS) {
            if (contest_name.includes(key)) {
                console.log(`Banning ${contest_name} due to ${key}`);
                return true;
            }
        }
        return false;
    }

    async function update_ALL_PROBLEMS() {
        const key = get_all_problems_GM_KEY();
        const value = GM_getValue2(key);
        if (should_recompute(value) === false) {
            console.log("using GM_getValue to update_ALL_PROBLEMS");
            ALL_PROBLEMS = value;
            return;
        }
        try {
            const problems = await get_all_problems();
            await update_CONTEST_ID_TO_CONTEST_NAME();

            let max_rating = 0;
            for (const problem of problems) {
                max_rating = Math.max(max_rating, get_rating(problem.rating));
            }

            ALL_PROBLEMS = Array.from({length: max_rating+1}, () => [])

            for (let problem of problems) {
                if(is_banned_problem(problem)){
                    continue;
                }
                const rating = get_rating(problem.rating);
                const contest_id = problem.contestId;
                const problem_code = problem.index;
                const problem_url = get_problem_url(contest_id, problem_code);
                ALL_PROBLEMS[rating].push(problem_url);
            }
            GM_setValue(key, ALL_PROBLEMS);
        } catch (err) {
            console.error("Error fetching problems:", err);
            return [];
        }
    }

    function remove_solved_problems(solved_problems,problems){
        const unsolved_problems =[];
        for(const problem of problems){
            if(solved_problems.has(problem)){
                console.log("removing already solved: ",problem);
                continue;
            }
            unsolved_problems.push(problem);
        }
        return unsolved_problems;
    }
    function save_TODO_PROBLEMS(){
        const key = get_todo_GM_KEY();
        GM_setValue(key,TODO_PROBLEMS);
    }

    function add_to_TODO_PROBLEMS(url){
        const entry = {
            url: url,
            date: get_date_ist()
        };
        console.log("pushing ",entry);
        TODO_PROBLEMS.push(entry);
        save_TODO_PROBLEMS();
    }
    function find_from_TODO_PROBLEMS(url){
        return TODO_PROBLEMS.findIndex(p => p.url === url);
    }

    function remove_from_TODO_PROBLEMS(url){
        const index = find_from_TODO_PROBLEMS(url);
        if (index !== -1) {
            const removed = TODO_PROBLEMS.splice(index, 1)[0];
            console.log("Removed from TODO_PROBLEMS:", removed);
            save_TODO_PROBLEMS();
        } else {
            console.log("Problem not found in TODO_PROBLEMS:", url);
        }
    }

    async function update_TODO_PROBLEMS() {
        const key = get_todo_GM_KEY();
        TODO_PROBLEMS=GM_getValue(key,[]);
    }

    async function update_global_varaibles(){
        DATE_STRING = get_date_ist();
        update_USER_NAME();
        update_TODO_PROBLEMS();
        await update_ALL_PROBLEMS();
    }

    async function handle_potd_click(){
        const potd_url = await get_potd_url();
        console.log("potd_url",potd_url);
        load_url(potd_url);
    }

    function hide_problem_tags(){
        if(!(USER_NAME == DEFAULT_USER_NAME || USER_NAME == ADMIN_USER_NAME)){ //for now only keep this functionality local
           return;
        }
        const tags=document.querySelectorAll(TAG_SELECTOR);
        tags.forEach(tag => {
            const text = tag.textContent.trim();
            if (!RATING_TAG_REGEX.test(text)) {
                tag.parentElement.style.display = "none";
            }
        });
    }

    function add_at_begining_in_user_name(element){
        const user_name_div = get_user_name_div();
        if (!user_name_div) return;
        user_name_div.prepend(document.createTextNode(" | "));
        user_name_div.prepend(element);
    }

    async function add_potd_link(streak) {
        const potd_link = document.createElement("a");
        potd_link.textContent = `${POTD_TEXT} ${streak}`;
        potd_link.href = "#";

        potd_link.addEventListener(CLICK, async (e) => {
            e.preventDefault();
            await handle_potd_click();
        });
        add_at_begining_in_user_name(potd_link);
    }

    function get_todo_url() {
        if (TODO_PROBLEMS.length === 0) {
            return null;
        }
        const todayStr = get_date_ist();
        const today = new Date(todayStr);

        // Filter problems older than 30 days
        const oldProblems = TODO_PROBLEMS.filter(p => {
            return diff_in_days_from_today(p.date) > TODO_DAYS_THRESHOLD;
        });

        let chosenProblem;
        if (oldProblems.length > 0) {
            chosenProblem = pick_random_element(oldProblems);
            console.log("Picked a problem older than 30 days:", chosenProblem);
        } else {
            chosenProblem = pick_random_element(TODO_PROBLEMS);
            console.log("No problem older than 30 days, picked a random problem:", chosenProblem);
        }
        return chosenProblem.url;
    }

    function handle_todo_click() {
        const url = get_todo_url();
        if (!url) {
            alert("Congrats! You don't have any problems in TODO.");
            return;
        }
        load_url(url);
    }

    function add_todo_link() {
        const todo_link = document.createElement("a");
        todo_link.textContent = `${TODO_TEXT} (${TODO_PROBLEMS.length})`;
        todo_link.href = "#";

        todo_link.addEventListener(CLICK, async (e) => {
            e.preventDefault();
            handle_todo_click();
        });
        add_at_begining_in_user_name(todo_link);
    }

    // Common function to create a button/emoji span
    function create_todo_span(text, title) {
        const span = document.createElement("span");
        span.textContent = text;
        span.title = title;
        span.style.cursor = "pointer";
        return span;
    }

    function add_mark_as_done_button(url) {
        const problem_favorite_image = get_problem_favorite_image();
        if (!problem_favorite_image) return;

        const doneCheckbox = document.createElement("input");
        doneCheckbox.type = "checkbox";
        doneCheckbox.title = MARK_AS_DONE_TEXT;
        doneCheckbox.style.cursor = "pointer";

        doneCheckbox.addEventListener(CLICK, () => {
            remove_from_TODO_PROBLEMS(url);
            refresh(); // refresh page
        });
        problem_favorite_image.parentElement.appendChild(doneCheckbox);
    }

    function add_mark_as_to_do_button(url) {
        const problem_favorite_image = get_problem_favorite_image();
        if (!problem_favorite_image) return;

        const toDoButton = create_todo_span(ADD_TO_TODO_EMOJI,ADD_TO_TODO_TEXT);
        toDoButton.addEventListener(CLICK, () => {
            add_to_TODO_PROBLEMS(url);
            refresh(); // refresh page
        });
        problem_favorite_image.parentElement.appendChild(toDoButton);
    }

    function add_todo_logic_on_problem_page(){
        const url = window.location.href;
        if(is_problem_page(url) == false){
            return;
        }
        const isInTodo = TODO_PROBLEMS.filter(p => p.url === url).length > 0;
        if(isInTodo){
            add_mark_as_done_button(url);
        }else{
            add_mark_as_to_do_button(url);
        }
    }
    update_global_varaibles();
    hide_problem_tags();
    add_todo_link();
    add_todo_logic_on_problem_page();
    let streak=""//change and implement calculating streak logic
    add_potd_link(streak);
})();
