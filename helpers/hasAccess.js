const jwt_decode = require('jwt-decode');

const { validatePolygonLoginSig } = require('./validatePolygonBearerSig');

const { validateGoogleSig } = require('./validateGoogleBearerSig');

module.exports.validateToken = async function (token, roles) {
    
    try {
        // Verify and decode the JWT token
        const decoded = jwt_decode(token); 

        console.log('\n\n\n\n\n')

        console.log(decoded);

        console.log('\n\n\n\n\n')

        // console.log(decoded)
        // Check if the token has expired
        const currentTime = Math.floor(Date.now() / 1000);

        console.log('\n\n\n\n')
        console.log(decoded.exp, currentTime, "decoded.exp < currentTime: ", decoded.exp < currentTime);
        console.log('\n\n\n\n')

        if (decoded.exp < currentTime) {
            console.log('falseeeeeeeeeeeeeeeee');
            return false;
        }

        console.log('\n', currentTime, '\n', decoded.exp);

        // Create a variable to store the result
        let result;

        // Check if the 'did' key exists
        if ((typeof decoded.userInfo !== 'undefined') && decoded.userInfo.did) {

            const bool = await validatePolygonLoginSig(token);

            if(bool){

                result = 1;

            }
            else{

                return false;

            }

        } else if (decoded.email) {

            const bool = await validateGoogleSig(token);

            console.log('google login signature: ', bool);

            if(bool){

                const emailId = decoded.email;

                const valid = emailId.endsWith('@sakhaglobal.com');
    
                console.log('email domain name: ', valid);
    
                if (valid) {
    
                    console.log('valid domain');
    
                    result = 2;
    
                }
                else {

                    console.log('Invalid Email Domain');
    
                    return false;
    
                }
            }
            else{

                console.log("Invalid google signature");

                return false;

            }


        } else {

            throw new Error('Token does not contain "did" or "email"');

        }

        // Check if the result is in the roles collection

        console.log('\n\n\n\n');

        console.log('roles.includes(result): ', roles, result, roles.includes(result));

        console.log('\n\n\n\n');

        if (roles.includes(result)) {
            console.log('returning true: ', true);
            return true;
        } else {
            console.log('returning false: ', false);
            return false;
        }
    } catch (error) {
        console.error(error.message);
        return false;
    }
}


// const token = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mbyI6eyJkaWQiOiJkaWQ6cG9seWdvbmlkOnBvbHlnb246bXVtYmFpOjJxTFM1eVBOZTdCWHpVV2d3UFBWSkNyWkZpZ3hVMnV4S0ZzcDZ0MzkzUSIsInNlc3Npb24iOiI4Yzc1NDgzOC01OWYwLTQ1NDctODU0Yy00NGU5MTY5MWQwMzUiLCJpc0VtcGxveWVlZSI6MSwibG9naW5UeXBlIjoicG9seWdvbiJ9LCJpYXQiOjE2OTU5ODYxMjMsImV4cCI6MTY5NTk4OTEyM30.IsMDi5szjRQVWnu3tmGSeA46w_g4lqcQZKiIHiJdt7BmfLq0YZW5BUYIIw95cxojDZXNO1uwPpcQ1OMyWtODc5P7AJXJdO5QpGNhY5RImDMkd11BC_J_6YIpOKwXfehaPLwLWnB6EwxEQUXsA_AZZRt1_Zbpn6k0Adjn93IMZJXs0J6SYLK5BerThvJ_898pGY7tc3Vlhzdw4VH9orWywHnZz4c6PZBwqd3AhzIW-JTD89pOqhl5G82HhNC6ejFxj7FdHWyWLFTUNy5PT54FUnE14kn9Y01H-QhxnjqyWZCmbQQL2hiJKrSUNzylDqCl0dNHGNZrVBbwmhJsKjPl8acLU0XXF74we5d87hVzD-byHwlufyvYstJsEoNdhqzJ85iIILIOIOmgttiIZRzmkRwrehIug7zJJvkqjg9kAhK10OoI2YAagwEQShBwHJ8azz3D3cRRNOh6pv-ENbZbcHDJPz0OAgD7SyX7CBRnazkGBenncXsnyFP7rD1pcdAP7X3cI-SnJKCMJIkoqjPenFmkwcmzwAfCvjI9jpDiwDSYs9x2Pszvfpa_HMept4RS-ZtFX3cmomqoxkL-z2L7M3cpmmfZYAHOBwE5A78--1J9inS1KoDUNwqRn6WZL8LA0yzq1-WOIUHqgaVUCfNimUrhBc7GL6Pfidl4smeTzV0';
// const roles = [1, 2, 3, 4];

// if (validateToken(token, roles)) {
//     console.log('Token is valid and has a matching role',);
// } else {
//     console.log('Token is invalid or does not have a matching role');
// }


// const jwt_decode = require('jwt-decode');

// module.exports.validateToken = async function (token, roles) {
//     try {
//         // Verify and decode the JWT token
//         const decoded = jwt_decode(token); // Replace 'your-secret-key' with your actual secret key

//         console.log('\n\n\n\n\n')

//         console.log(decoded);

//         console.log('\n\n\n\n\n')

//         // console.log(decoded)
//         // Check if the token has expired
//         const currentTime = Math.floor(Date.now() / 1000);

//         console.log('\n\n\n\n')
//         console.log(decoded.exp, currentTime, "decoded.exp < currentTime: ", decoded.exp < currentTime);
//         console.log('\n\n\n\n')

//         if (decoded.exp < currentTime) {
//             console.log('falseeeeeeeeeeeeeeeee');
//             return false;
//         }

//         console.log('\n', currentTime, '\n', decoded.exp);

//         // Create a variable to store the result
//         let result;

//         // Check if the 'did' key exists
//         if ((typeof decoded.userInfo !== 'undefined') && decoded.userInfo.did) {

//             result = 1;

//         } else if (decoded.email) {

//             const emailId = decoded.email;

//             const valid = emailId.endsWith('@sakhaglobal.com');

//             console.log('emaillllllllllllllllllll: ');

//             if (valid) {

//                 console.log('validddddddddddddddddd: ');

//                 result = 2;

//             }
//             else {

//                 return false;

//             }

//         } else {

//             throw new Error('Token does not contain "did" or "email"');

//         }

//         // Check if the result is in the roles collection

//         console.log('\n\n\n\n');

//         console.log('roles.includes(result): ', roles, result, roles.includes(result));

//         console.log('\n\n\n\n');

//         if (roles.includes(result)) {
//             console.log('returning ', true);
//             return true;
//         } else {
//             console.log('returning ', false);
//             return false;
//         }
//     } catch (error) {
//         console.error(error.message);
//         return false;
//     }
// }


// const token = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mbyI6eyJkaWQiOiJkaWQ6cG9seWdvbmlkOnBvbHlnb246bXVtYmFpOjJxTFM1eVBOZTdCWHpVV2d3UFBWSkNyWkZpZ3hVMnV4S0ZzcDZ0MzkzUSIsInNlc3Npb24iOiI4Yzc1NDgzOC01OWYwLTQ1NDctODU0Yy00NGU5MTY5MWQwMzUiLCJpc0VtcGxveWVlZSI6MSwibG9naW5UeXBlIjoicG9seWdvbiJ9LCJpYXQiOjE2OTU5ODYxMjMsImV4cCI6MTY5NTk4OTEyM30.IsMDi5szjRQVWnu3tmGSeA46w_g4lqcQZKiIHiJdt7BmfLq0YZW5BUYIIw95cxojDZXNO1uwPpcQ1OMyWtODc5P7AJXJdO5QpGNhY5RImDMkd11BC_J_6YIpOKwXfehaPLwLWnB6EwxEQUXsA_AZZRt1_Zbpn6k0Adjn93IMZJXs0J6SYLK5BerThvJ_898pGY7tc3Vlhzdw4VH9orWywHnZz4c6PZBwqd3AhzIW-JTD89pOqhl5G82HhNC6ejFxj7FdHWyWLFTUNy5PT54FUnE14kn9Y01H-QhxnjqyWZCmbQQL2hiJKrSUNzylDqCl0dNHGNZrVBbwmhJsKjPl8acLU0XXF74we5d87hVzD-byHwlufyvYstJsEoNdhqzJ85iIILIOIOmgttiIZRzmkRwrehIug7zJJvkqjg9kAhK10OoI2YAagwEQShBwHJ8azz3D3cRRNOh6pv-ENbZbcHDJPz0OAgD7SyX7CBRnazkGBenncXsnyFP7rD1pcdAP7X3cI-SnJKCMJIkoqjPenFmkwcmzwAfCvjI9jpDiwDSYs9x2Pszvfpa_HMept4RS-ZtFX3cmomqoxkL-z2L7M3cpmmfZYAHOBwE5A78--1J9inS1KoDUNwqRn6WZL8LA0yzq1-WOIUHqgaVUCfNimUrhBc7GL6Pfidl4smeTzV0';
// const roles = [1, 2, 3, 4];

// if (validateToken(token, roles)) {
//     console.log('Token is valid and has a matching role',);
// } else {
//     console.log('Token is invalid or does not have a matching role');
// }





// app.post('/query', (req, res) => {

//     const bearerHeader = req.headers['authorization'];
  
//     if (typeof bearerHeader !== 'undefined') {
  
//       // employee only
//       const roles = [1];
  
//       const bearer = bearerHeader.split(' ');
  
//       const jwt = bearer[1];
  
//       const bool = validateToken(jwt, roles);
  
  
//       console.log('\n\n\n\n');
//       console.log(roles);
//       console.log('emploeeeeeeeeeeee resultttttttttttttttttttttttttttt of access ', bool);
//       console.log('\n\n\n\n');
  
//       if (bool) {
  
//         const { pseudonym, executiveId, priority, query } = req.body;
//         const requestDTO = new AddQueryRequestDTO(pseudonym, executiveId, priority, query);
  
//         // User has no in-process queries, submit the new query
//         const insertQuery = `
//               INSERT INTO query (pseudonym, executive_id, priority, query)
//               VALUES (?, ?, ?, ?)
//             `;
  
//         // db.query(insertQuery, [requestDTO.pseudonym, requestDTO.executiveId, requestDTO.priority, requestDTO.query], (err, result) => {
//         db.query(insertQuery, ["\"frozen\"", requestDTO.executiveId, requestDTO.priority, requestDTO.query], (err, result) => {
  
//           if (err) {
//             console.error('Error inserting data into query table: ' + err.message);
//             res.status(500).json(new ApiResponseDTO('Internal server error'));
//           } else {
//             console.log('Data inserted successfully');
//             res.status(200).json(new ApiResponseDTO('Data inserted successfully'));
//           }
//         });
//       }
//     }
//   });
