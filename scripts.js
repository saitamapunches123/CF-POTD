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
  3) Remove problems that are language specific (i.e doesnt support C++)
*/
const DEBUG_MODE = "DEBUG";
const PROD_MODE = "PROD";
const MODE = PROD_MODE; // change if doing devlopment

const NEG_DELTA=1,POS_DELTA=2; //Change if you want a different distribution
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
]; // To remove problem specific remove these contests
const LANG_CHOSER = ".lang-chooser"; // this div containse USER_NAME and will add "POTD" here
const POTD_TEXT = "POTD";
const DEFAULT_GM_VALUE = -1;

let ALL_PROBLEMS = []; // initialized in update_ALL_PROBLEMS
let USER_NAME = DEFAULT_USER_NAME;
let CONTEST_ID_TO_CONTEST_NAME = []; // initialized in update_CONTEST_ID_TO_CONTEST_NAME
let DATE_STRING;

(async () => {
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    function should_recompute(value){
        return (value === DEFAULT_GM_VALUE || MODE === DEBUG_MODE);// in DEBUG_MODE recompute everytime
    }
    function GM_getValue2(key){
        return GM_getValue(key, DEFAULT_GM_VALUE);
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
        const lang_chooser_div = document.querySelector(LANG_CHOSER);
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

    async function get_solved_problems(){
        const solved = new Set();
        const user_statuses = await get_user_status();
        for (const sub of user_statuses) {
            if (sub.verdict === OK_VERDICT) {
                const p = sub.problem;
                const url=get_problem_url(p.contestId, p.index);
                solved.add(url);
            }
        }
        return solved;
    }

    async function get_potd_url() {
        const key = get_potd_GM_KEY();
        const value = GM_getValue2(key);
        let flattened_problems;
        if(USER_NAME == DEFAULT_USER_NAME){
            if(should_recompute(value) === false){
                return value;
            }
            flattened_problems = ALL_PROBLEMS.flat();
        }else{
            const solved_problems = await get_solved_problems();
            if(should_recompute(value) === false && solved_problems.has(value) == false){
                return value; //if the user has not solved the previous POTD use it
            }
            const user_profile = await get_user_profile();
            const user_rating = get_rating(user_profile.rating);
            flattened_problems = get_potd_problems_around_rating(user_rating);
            flattened_problems = remove_solved_problems(solved_problems, flattened_problems);
        }
        const random_index = Math.floor(Math.random() * flattened_problems.length);
        GM_setValue(key, flattened_problems[random_index]);
        return flattened_problems[random_index];
    }

    function update_USER_NAME() {
        const user_name_div = get_user_name_div();
        if (!user_name_div) return DEFAULT_USER_NAME;

        const user_name_a = user_name_div.querySelectorAll("a")[1];
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

    async function update_global_varaibles(){
        DATE_STRING = get_date_ist();
        update_USER_NAME();
        await update_ALL_PROBLEMS();
    }

    async function handle_potd_click(){
        await update_global_varaibles();
        const potd_url = await get_potd_url();
        console.log("potd_url",potd_url);
        if(MODE !== DEBUG_MODE){
            window.location.href = potd_url;
        }
    }

    async function make_ui_change(streak) {
        const user_name_div = get_user_name_div();

        const potd_link = document.createElement("a");
        potd_link.textContent = `${POTD_TEXT} ${streak}`;
        potd_link.href = "#";

        potd_link.addEventListener("click", async (e) => {
            e.preventDefault();
            await handle_potd_click();
        });
        user_name_div.prepend(document.createTextNode(" | "));
        user_name_div.prepend(potd_link);
    }

    let streak=""//change and implement calculating streak logic
    make_ui_change(streak);
})();
