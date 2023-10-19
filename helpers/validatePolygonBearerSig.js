const jwt = require('jsonwebtoken');

const path = require('path');

module.exports.validatePolygonLoginSig = async function (bearerToken) {

    if (bearerToken) {

        try {

            const fs = require('fs');

            const publicKeyPath = path.join(__dirname, 'public.key');

            const publicKey = fs.readFileSync(publicKeyPath, 'utf8');

            // let publicKey = fs.readFileSync('./public.key');

            const bool = jwt.verify(bearerToken, publicKey, {
                algorithms: 'RS256'
            });

            console.log(bool);

            return true;

        }
        catch (err) {

            console.log(err);

            return false;

        }

    }
    else {

        return false;

    }

}


// // const publicKey = '0quLYDiZIxssFKreHcXeeUIbgyU-dctbQXTfBTbAKp4Jl_TH-FQt3EfBVbo2P_1bkH-6ofvDSkQDUbigOhN4zx7JwbjAl8P18-dgjxuhF9HRdZA2W54VxBspEuHhqpsFZKoH_409ywbnc0DtAT-OQR3oQ-6ZnJfUOkLvw7o62QSDyscEi_zh8NIAGQnBo98UVVWr6lbR_PIm7l_NZu0LAux-P5Av-CxAxf32Dvl6crfv_I8ME3_fRisfKaVn5qOt_XuSXmygtTtT94lwelCCuutT6VjjIe397j83yR6LDZACOY7aAw8dx_rb3TS-SgvxQoBshj3142B4RFTVwupyQQ';
// const fs = require('fs');

// let publicKey = fs.readFileSync('./public.key');

// const bearerToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mbyI6eyJkaWQiOiJkaWQ6cG9seWdvbmlkOnBvbHlnb246bXVtYmFpOjJxTFM1eVBOZTdCWHpVV2d3UFBWSkNyWkZpZ3hVMnV4S0ZzcDZ0MzkzUSIsInNlc3Npb24iOiI4Yzc1NDgzOC01OWYwLTQ1NDctODU0Yy00NGU5MTY5MWQwMzUiLCJpc0VtcGxveWVlZSI6MSwibG9naW5UeXBlIjoicG9seWdvbiJ9LCJpYXQiOjE2OTU5ODYxMjMsImV4cCI6MTY5NTk4OTEyM30.IsMDi5szjRQVWnu3tmGSeA46w_g4lqcQZKiIHiJdt7BmfLq0YZW5BUYIIw95cxojDZXNO1uwPpcQ1OMyWtODc5P7AJXJdO5QpGNhY5RImDMkd11BC_J_6YIpOKwXfehaPLwLWnB6EwxEQUXsA_AZZRt1_Zbpn6k0Adjn93IMZJXs0J6SYLK5BerThvJ_898pGY7tc3Vlhzdw4VH9orWywHnZz4c6PZBwqd3AhzIW-JTD89pOqhl5G82HhNC6ejFxj7FdHWyWLFTUNy5PT54FUnE14kn9Y01H-QhxnjqyWZCmbQQL2hiJKrSUNzylDqCl0dNHGNZrVBbwmhJsKjPl8acLU0XXF74we5d87hVzD-byHwlufyvYstJsEoNdhqzJ85iIILIOIOmgttiIZRzmkRwrehIug7zJJvkqjg9kAhK10OoI2YAagwEQShBwHJ8azz3D3cRRNOh6pv-ENbZbcHDJPz0OAgD7SyX7CBRnazkGBenncXsnyFP7rD1pcdAP7X3cI-SnJKCMJIkoqjPenFmkwcmzwAfCvjI9jpDiwDSYs9x2Pszvfpa_HMept4RS-ZtFX3cmomqoxkL-z2L7M3cpmmfZYAHOBwE5A78--1J9inS1KoDUNwqRn6WZL8LA0yzq1-WOIUHqgaVUCfNimUrhBc7GL6Pfidl4smeTzV0';

// const bool = jwt.verify(bearerToken, publicKey, {
//     algorithms: 'RS256'
// });

// console.log(bool);