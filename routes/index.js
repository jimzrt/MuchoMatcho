module.exports = function(io) {
    var Promise = require('bluebird');

    var express = require('express');
    var router = express.Router();
    var models = require('../models');
    var highscore = models.highscore;
    var movies = models.movies;
    var directors = models.directors;
    var actors = models.actors;
    var item_factor_values = models.item_factor_values;

    var playerWaiting = [];
    var playerIngame = [];
    var games = [];

    router.get('/', function(req, res, next) {
        highscore.findAll({
            limit: 10,
            order: [
                ['Points', 'DESC']
            ]
        }).then(highscores => {
            res.render('index.ejs', {
                "highscores": highscores
            });
        });

    });

    io.on('connection', function(socket) {

        console.log(socket.id + ' connected');
        socket.emit("username");

        socket.on('ready', function(username) {

            socket.guesses = [];
            socket.username = username;
            console.log(socket.username + " waiting");
            socket.emit("waiting");
            playerWaiting.push(socket);

            if (playerWaiting.length > 1) {

                makeGame(playerWaiting.shift(), playerWaiting.shift());

            }

            io.emit('totalPlayers', (playerWaiting.length + playerIngame.length));

        })

        socket.on('disconnect', function() {
            console.log(this.id + ' disconnected');

            if (this.game) {
                endGame(this.game);
            } else {
                var index = playerWaiting.indexOf(this);
                if (index > -1) {
                    playerWaiting.splice(index, 1);
                };

            }

            io.emit('totalPlayers', (playerWaiting.length + playerIngame.length));

        });

        socket.on('makeGuess', function(guess) {
            guess = guess.toLowerCase().trim();
            console.log(socket.id + ' made guess: ' + guess);
            if (socket.game.getOtherPlayer(socket).guesses.indexOf(guess) > -1) {
                console.log("guess match found!");
                socket.game.stopMatchTimer();
                socket.game.score += calculateScore(socket.game.matchTime);
                io.to(socket.game.gameID).emit('guessMatch', guess, socket.game.matchTime, calculateScore(socket.game.matchTime), socket.game.score);

                setTimeout(function() {
                    newRound(socket.game);

                }, 5000);

                // highscore.build({
                //     Points: calculateScore(socket.game.time)
                // }).save();

            } else {
                console.log("no guess match");
                if (socket.guesses.indexOf(guess) > -1) {
                    console.log("duplicate guess");
                } else {
                    socket.guesses.push(guess);

                }

                socket.emit("wrongGuess", guess);

            }
        });

    });

    function makeGame(playerOne, playerTwo) {
        console.log("Server: Starting game between " + playerOne.username + " and " + playerTwo.username);
        var game = {};
        game.gameID = playerOne.id + playerTwo.id;
        game.score = 0;
        game.matches = 1;
        game.playerOne = playerOne;
        game.playerTwo = playerTwo;
        game.factorID = getRandomFactorID();
        game.getOtherPlayer = function(player) {
            if (game.playerOne == player)
                return playerTwo;
            else
                return playerOne;
        };

        game.globalTime = 600;
        game.matchTime = 0;
        game.startMatchTimer = function() {
            game.matchTime = 0;

            game.matchTimer = setInterval(function() {
                game.matchTime++;
                // io.to(game.gameID).emit('time', game.matchTime++, calculateScore(game.matchTime));
                io.to(game.gameID).emit('globalTime', game.globalTime--, calculateScore(game.matchTime), game.score, game.matches);

                if (game.globalTime < 0) {
                    endGame(game);
                }

            }, 1000)
        };
        game.stopMatchTimer = function() {
            clearInterval(game.matchTimer);

        };
        game.restartMatchTimer = function() {
            game.stopMatchTimer();
            game.startMatchTimer();
        };
        games.push(game);

        playerOne.game = game;
        playerOne.join(game.gameID);
        playerTwo.game = game;
        playerTwo.join(game.gameID)

        playerIngame.push(playerOne);
        playerIngame.push(playerTwo);

        startGame(game);

    }

    function startGame(game) {
        game.startMatchTimer();

        io.to(game.gameID).emit('startGame', game.playerOne.username + " and " + game.playerTwo.username, game.matches);
        //    game.startTimer();

        getMovieSelection(game.factorID).then(movies => {

            movies.forEach(movie => {
                Promise.all([getDirectors(movie.movielens_id), getActors(movie.movielens_id)]).spread(function(directors, actors) {
                    movie.dataValues.directors = directors;
                    movie.dataValues.actors = actors;

                    io.to(game.gameID).emit('movies', movie);

                })

            });

        });

    }

    function newRound(game) {
        game.matches++;
        game.factorID = getRandomFactorID();
        game.playerOne.guesses = [];
        game.playerTwo.guesses = [];
        // game.restartTimer();
        startGame(game);

    }

    function endGame(game) {

        //remove Game
        game.stopMatchTimer();

        io.to(game.gameID).emit('endGame', game.score);

        var index = games.indexOf(game);
        if (index > -1) {
            games.splice(index, 1);

            console.log("Ending Game with id " + game.gameID);

            index = playerIngame.indexOf(game.playerOne);
            if (index > -1) {
                playerIngame.splice(index, 1);
            };
            index = playerIngame.indexOf(game.playerTwo);
            if (index > -1) {
                playerIngame.splice(index, 1);
            };
        }

    };

    function getRandomFactorID() {
        return Math.floor((Math.random() * 20) + 3);
    }

    function getDirectors(movieID) {
        return directors.findAll({
            include: [{
                model: models.movies,
                where: {
                    'movielens_id': movieID
                }
            }]

        });
    }

    function getActors(movieID) {
        return actors.findAll({
            include: [{
                model: models.movies,
                where: {
                    'movielens_id': movieID
                }
            }]
        });
    }

    function getMovieSelection(factorID) {

        return movies.findAll({

            limit: 20,
            order: [
                [{
                    model: item_factor_values,
                    as: 'factor_value'
                }, 'value', 'DESC']
            ],

            include: [{
                model: item_factor_values,
                as: 'factor_value',
                where: {
                    'factor_index': factorID
                }
            }]
        }).then(movies => {
            shuffle(movies);
            movies = movies.slice(0, 3);

            return movies;

        });

    }

    function shuffle(array) {
        var i = 0,
            j = 0,
            temp = null

        for (i = array.length - 1; i > 0; i -= 1) {
            j = Math.floor(Math.random() * (i + 1))
            temp = array[i]
            array[i] = array[j]
            array[j] = temp
        }
    }

    function calculateScore(time) {
        return parseInt(1000 * Math.pow(0.95, time / 10));
    }

    return router;
};