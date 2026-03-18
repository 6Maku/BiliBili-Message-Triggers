//______________ Convenience Code ______________
//Ignore this
class Activity {
    constructor(trigger, image, sound) {
        this.trigger = trigger;
        this.image = image;
        this.sound = sound;
    }
}

//______________________________________________


//THINGS YOU NEED TO SET BELOW


// Trigger phrase, Iamge file .withExtension, Sound file .withExtension
// Paths are from 'overlay/Assets/', so a file 'overlay/Assets/test.png' is just 'test.png'
// You can also replace assets files with empty strings "", to no trigger the related effect (i.e. only image)
const ActivityTriggers = [
    //new Activity("test", "example.png", "example.wav"),
    new Activity("test", "Xinema.png", "InceptionHorn.mp3"),
];

//Example room id:
//https://live.bilibili.com/1811400103?broadcast_type=0&is_room_feed=1&spm_id_from=333.1387.to_liveroom.0.click&live_from=86002
//Notice it needs to be from live room and not profile
const ROOMID = 1811400103


//COOKIES
//SESSDATA is a very long string of characters numbers and symobls (around 220 for me)
const SESSDATA              = "SESSDATA=...";
// buvid is of the form buvid3=8values-4values-4values-4values-17valuesinfoc
const buvid3                = "buvid3=...";

//const COOKIE = `${SESSDATA}; ${bili_jct}; ${buvid3}; ${DedeUserID}; ${DedeUserID__ckMd5};`
const COOKIE = `${SESSDATA}; ${buvid3};`



//______________________________________________

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ActivityTriggers, ROOMID, COOKIE, Activity };
}