const jwt_decode = require('jwt-decode');

const { validateToken } = require("../helpers/hasAccess");

const verifyToken = (roles) => {

    try {

        console.log('user roles: ', roles);

        return async (req, res, next) => {

            const bearerHeader = req.headers['authorization'];

            if (typeof bearerHeader !== 'undefined') {

                // // employee only
                // const roles = [1];

                const bearer = bearerHeader.split(' ');

                const jwt = bearer[1];

                const bool = await validateToken(jwt, roles);


                console.log('\n\n\n\n');
                console.log('roles: ', roles);
                console.log('emploee resulttttt of access: ', bool);
                console.log('\n\n\n\n');

                if (bool) {

                    return next();

                }
                else {

                    res.status(401).json({
                        success: false,
                        Error: 'Invalid token'
                    });

                }

            }
            else {
                res.status(403).json({
                    success: false,
                    Error: 'Unauthorized'
                })
            }

        };

    }
    catch (error) {
        res.status(500).send("Could not able to authenticate!!!")
    }

};

module.exports = verifyToken;
